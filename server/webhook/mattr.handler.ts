import { oneLineTrim as markdown } from 'common-tags';
import Redis from 'ioredis';
import ms from 'ms';
import Pusher from 'pusher';

import * as t from '@navch/codec';
import { sleep } from '@navch/common';
import { makeHandler, makeHandlers } from '@navch/http';

import * as pusherAdapter from '../subscription/pusher.adapter';
import * as pusherRepo from '../subscription/pusher.repository';
import * as influxdbModule from '../telemetry/influxdb';
import * as signatures from './signature';

const HandlerContext = t.type({
  pusher: t.union([t.instanceOf(Pusher), t.null]),
  redis: t.type({
    pusher: t.instanceOf(Redis),
  }),
  influxdb: t.instanceOf(influxdbModule.InfluxClientPool),
});

const ChannelOptions = t.partial({
  /**
   * Defer responding callback requests, supports user friendly duration formats.
   *
   * This can be used to simulate slow service endpoint. Maximum allowed duration is 5 seconds.
   */
  defer: new t.Type<number, string, string>(
    'DeferDuration',
    (v): v is number => typeof v === 'number',
    (u, c) => {
      const duration = ms(u);
      if (duration > 0 && duration <= 5000) {
        return t.success(duration);
      }
      return t.failure(u, c, 'Invalid value, must not be greater than 5s');
    },
    String
  ),
  /**
   * Optionally verify HTTP signature.
   */
  signature: signatures.SignatureScheme,
  /**
   * Optionally push telemetry data to InfluxDB.
   */
  influxdb: influxdbModule.ClientOptions,
});

const WebhookEventBody = t.type({
  event: t.type({
    id: t.string,
    type: t.string,
    timestamp: t.string,
  }),
  webhookId: t.string,
  deliveryId: t.string,
  deliveryTimestamp: t.string,
});

const postChannelRegister = makeHandler({
  route: '/webhook/mattr/channels',
  method: 'POST',
  input: { body: ChannelOptions },
  context: HandlerContext,
  handle: async (_1, options, { redis, logger }) => {
    logger.info('Register pusher channel', options);
    return await pusherRepo.insert(redis.pusher, options);
  },
});

const postWebhookEvent = makeHandler({
  route: '/webhook/mattr/events/:channelId?',
  method: 'POST',
  description: markdown`
    This is a _public_ callback endpoint for receiving the pushed events.

    If there exists a registered pub/sub channel, the request must be authenticated
    using HTTP signature, otherwise, respond immediately.
  `,
  input: {
    params: t.type({ channelId: t.union([t.undefined, t.string]) }),
    body: t.type({ event: t.unknown }),
  },
  context: HandlerContext,
  handle: async ({ channelId }, body, { redis, pusher, influxdb, logger, headers, path, req }) => {
    const { signature } = headers;
    logger.info('Received mattr event', { path, body, signature });

    // FIXME Not sure why influxdb-client-js build-in nanoseconds timer has
    // weird behavior in docker compose environment.
    //
    // @ts-ignore:next-line
    const { default: nanoTime } = await import('nano-time');

    const channel = channelId ? await pusherRepo.findById(redis.pusher, channelId) : undefined;
    const metadata = channel ? t.validate(ChannelOptions, channel.metadata) : undefined;
    //
    // Send telemetry data if configured
    //
    if (channel && metadata?.influxdb && WebhookEventBody.is(body)) {
      logger.debug('Send telemetry data to InfluxDB');
      const now = Date.now();
      const eventTimestamp = new Date(body.event.timestamp).getTime();
      const deliveryTimestamp = new Date(body.deliveryTimestamp).getTime();
      /**
       * The estimated kafka consumer group lag in milliseconds. This metrics uses
       * the time difference between event creation time and event delivery time.
       *
       * Note that the delivery request time is NOT included.
       */
      influxdb.writePoint(metadata.influxdb, 'webhook_event', point => {
        return point
          .tag('channel', channel.id)
          .tag('webhook_id', body.webhookId)
          .tag('event_type', body.event.type)
          .intField('event_lag_ms', deliveryTimestamp - eventTimestamp)
          .intField('event_arrival_lag_ms', now - eventTimestamp)
          .intField('delivery_lag_ms', now - deliveryTimestamp)
          .timestamp(nanoTime());
      });
    }
    //
    // Verify signature against Joyent' scheme
    //
    let verifyResult: signatures.VerifyResult | undefined = undefined;
    if (channelId && metadata && metadata.signature) {
      verifyResult = await signatures.verifySignature({
        logger,
        request: req,
        scheme: metadata.signature,
      });
      if (!verifyResult.verified) {
        logger.warn('Unable to verify signature', verifyResult);
      }
    }
    //
    // Forward event to PubSub service if enabled
    //
    if (pusher && channel && verifyResult?.verified) {
      logger.debug('Skipped publishing event, no channel found');
      await pusherAdapter.publish(pusher, {
        channel,
        event: 'WEBHOOK_MATTR_EVENT',
        data: { event: body.event, signature, verifyResult },
      });
    }
    //
    // Defer sending response if enabled
    //
    if (metadata?.defer !== undefined) {
      logger.debug(`Defer response for ${metadata.defer}ms`);
      await sleep(metadata.defer);
    }
    return { status: 'Ok' };
  },
});

export const handlers = makeHandlers(() => [postWebhookEvent, postChannelRegister]);
