import { Redis } from 'ioredis';
import * as R from 'ramda';
import * as uuid from 'uuid';
import ms from 'ms';

import * as t from '@navch/codec';
import { NotFoundError } from '@navch/common';

import * as signatures from './signature';
import * as influxdbModule from '../telemetry/influxdb';
import * as pusherAdapter from '../subscription/pusher.adapter';

const WEBHOOK_CHANNEL_TTL = 3600 * 120; // 5 days

export type WebhookMetadata = t.TypeOf<typeof WebhookMetadata>;
export const WebhookMetadata = t.partial({
  /**
   * Defer responding callback requests, supports user friendly duration formats.
   *
   * This can be used to simulate slow service endpoint. Maximum allowed duration is 5 seconds.
   */
  defer: new t.Type<number, string, string>(
    'DeferDuration',
    (v): v is number => typeof v === 'number',
    (u, c) => {
      if (!u) return t.success(0);
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
  /**
   * Optionally push received data to Pusher.
   */
  pusher: pusherAdapter.PusherClientMetadata,
});

export type WebhookChannel = t.TypeOf<typeof WebhookChannel>;
export const WebhookChannel = t.type({
  id: t.string,
  createdAt: t.number,
  metadata: t.union([t.undefined, t.record(t.string, t.unknown)]),
});

export type WebhookEventRecord = t.TypeOf<typeof WebhookEventRecord>;
export const WebhookEventRecord = t.type({
  id: t.string,
  receivedAt: t.number,
  data: t.unknown,
});

export async function insert(redis: Redis, metadata?: WebhookMetadata): Promise<WebhookChannel> {
  const id = uuid.v4();
  const record = t.validate(WebhookChannel, { id, createdAt: Date.now(), metadata });
  await redis.set(record.id, JSON.stringify(record), 'EX', WEBHOOK_CHANNEL_TTL);
  return record;
}

export async function update(
  redis: Redis,
  channelId: string,
  metadata: WebhookMetadata
): Promise<WebhookChannel> {
  const record = await findById(redis, channelId);
  if (!record) {
    throw new NotFoundError(`No webhook channel found with ${channelId}`);
  }
  const updated = t.validate(WebhookChannel, R.mergeDeepRight(record, { metadata }));
  await redis.set(record.id, JSON.stringify(updated), 'EX', WEBHOOK_CHANNEL_TTL);
  return updated;
}

export async function findById(redis: Redis, channelId: string): Promise<WebhookChannel | undefined> {
  const record = await redis.get(channelId);
  if (!record) {
    return undefined;
  }
  return t.validate(WebhookChannel, JSON.parse(record));
}

export async function insertWebhookEvent<T>(redis: Redis, id: string, data: T): Promise<T> {
  const key = `webhook:event:${id}`;
  const record = { id, receivedAt: Date.now(), data };
  await redis.set(key, JSON.stringify(record), 'EX', 300);
  return record.data;
}

export async function findWebhookEventById(
  redis: Redis,
  id: string
): Promise<WebhookEventRecord | undefined> {
  const record = await redis.get(`webhook:event:${id}`);
  if (!record) {
    return undefined;
  }
  return t.validate(WebhookEventRecord, JSON.parse(record));
}
