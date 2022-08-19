import * as R from 'ramda';
import * as t from 'io-ts';
import * as uuid from 'uuid';
import { Redis } from 'ioredis';

import { validate } from '@navch/codec';
import { NotFoundError } from '@navch/common';

const TTL = 3600 * 120; // 5 days

type Metadata = Record<string, unknown>;

export type PusherChannel = t.TypeOf<typeof PusherChannel>;
export const PusherChannel = t.type({
  id: t.string,
  createdAt: t.number,
  metadata: t.union([t.undefined, t.record(t.string, t.unknown)]),
});

export async function insert(redis: Redis, metadata?: Metadata): Promise<PusherChannel> {
  const record = validate({ id: uuid.v4(), createdAt: Date.now(), metadata }, PusherChannel);
  await redis.set(record.id, JSON.stringify(record), 'EX', TTL);
  return record;
}

export async function update(redis: Redis, channelId: string, metadata?: Metadata): Promise<PusherChannel> {
  const record = await findById(redis, channelId);
  if (!record) {
    throw new NotFoundError(`No Pusher channel found with ${channelId}`);
  }
  const updated = validate(R.mergeDeepRight(record, { metadata }), PusherChannel);
  await redis.set(record.id, JSON.stringify(updated), 'EX', TTL);
  return updated;
}

export async function findById(redis: Redis, channelId: string): Promise<PusherChannel | undefined> {
  const record = await redis.get(channelId);
  if (!record) {
    return undefined;
  }
  return validate(JSON.parse(record), PusherChannel);
}
