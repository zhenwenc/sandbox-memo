import crypto from 'crypto';
import * as uuid from 'uuid';
import { InfluxDB, WriteApi, Point } from '@influxdata/influxdb-client';

// @ts-ignore:next-line
import currentNanoTime from 'nano-time';

import * as t from '@navch/codec';
import { Logger } from '@navch/common';

import { graceful } from '../utils';

const ServiceLogger = Logger.child({ name: 'influxdb' });

export type ClientOptions = t.TypeOf<typeof ClientOptions>;
export const ClientOptions = t.strict({
  /**
   * InfluxDB server base URL.
   */
  url: t.string,
  /**
   * InfluxDB server authentication token.
   */
  token: t.union([t.undefined, t.string]),
  /**
   * The destination organization for writes, either the ID or Name.
   */
  org: t.string,
  /**
   * The destination bucket for writes.
   */
  bucket: t.string,
});

export class InfluxClientPool {
  static getCacheKey(options: ClientOptions): string {
    // TODO normalize with `canonicalize`
    return crypto.createHash('sha256').update(JSON.stringify(options)).digest('base64');
  }

  readonly $instanceId = uuid.v4();
  readonly $storage = new Map<string, [WriteApi, ClientOptions, Date]>();

  /**
   * Helper function that returns the current timestamp since epoch in nanoseconds.
   *
   * FIXME Not sure why the build-in `influxdb-client-js` functions has weird
   * behavior in docker compose environment and/or NextJS dev server.
   */
  readonly currentTimestamp = () => currentNanoTime();

  /**
   * https://influxdata.github.io/influxdb-client-js/influxdb-client.influxdb.html
   */
  readonly getWriteApi = (options: ClientOptions): WriteApi => {
    const { org, bucket } = options;
    const cacheKey = InfluxClientPool.getCacheKey(options);

    let [client] = this.$storage.get(cacheKey) || [];
    if (!client) {
      ServiceLogger.info('Create InfluxDB client' + { clientPoolId: this.$instanceId });

      const db = new InfluxDB({
        url: options.url,
        token: options.token,
        // Reduced socket timeout to avoid potential attacks for client provided
        // client options, 10,000 milliseconds by default.
        timeout: 10000,
      });
      // Expecting point timestamps precision. Be aware that highly concurrent
      // requests could result in duplicate points with milliseconds precision.
      //
      // However, the current time in nanoseconds can’t precisely fit into a JS
      // number, which can hold at most 2^53 integer number. Nanosecond precision
      // numbers are thus supplied as a (base-10) string.
      //
      // https://influxdata.github.io/influxdb-client-js/influxdb-client.point.timestamp.html
      // https://docs.influxdata.com/influxdb/v2.4/write-data/best-practices/duplicate-points
      client = db.getWriteApi(options.org, options.bucket, 'ns', {
        // WriteApi buffers data into batches to optimize data transfer to InfluxDB
        // server. Delay between data flushes in milliseconds.
        //
        // When the application is running as Lambda Function, the container will
        // terminate after a certain period, reduce the flush interval to ensure
        // all data points are been flushed before termination. Alternatively, the
        // application should register a shutdown hook to `close()` the client.
        flushInterval: 5000,
        /**
         * Callback to inform about write errors.
         */
        writeFailed: (error, lines, attempt, expires) => {
          ServiceLogger.error('Failed to send lines', { error, lines, attempt, expires, org, bucket });
        },
        /**
         * Callback to inform about write success.
         */
        writeSuccess: lines => {
          ServiceLogger.info(`Successfully send ${lines.length} lines`, { org, bucket });
        },
      });
    }
    // Remembers WriteApi instances for consecutive requests, and renew the last
    // activity timestamp.
    this.$storage.set(cacheKey, [client, options, new Date()]);
    return client;
  };

  /**
   * https://influxdata.github.io/influxdb-client-js/influxdb-client.point.html
   */
  readonly writePoint = (options: ClientOptions, measurement: string, fn: (p: Point) => Point): WriteApi => {
    void this.invalidateExpiredItems(); // async cleanup
    const point = fn(new Point(measurement));
    const writeApi = this.getWriteApi(options);
    writeApi.writePoint(point);

    ServiceLogger.debug(`Write point: ${point.toLineProtocol(writeApi)}`);
    return writeApi;
  };

  readonly invalidateExpiredItems = async (): Promise<void> => {
    const now = Date.now();
    const maxAgeMs = 30_000;

    for (const [key, [client, , lastActivityAt]] of this.$storage) {
      const isExpired = lastActivityAt.getTime() + maxAgeMs < now;
      if (!isExpired) continue;

      ServiceLogger.info('Close InfluxDB client' + { clientPoolId: this.$instanceId });
      // Flush the buffered data immediately and cancels pending retries.
      await graceful(client.close());
      // Remove the cached client instance
      this.$storage.delete(key);
    }
  };
}
