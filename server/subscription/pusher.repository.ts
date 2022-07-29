import * as t from 'io-ts';
import * as uuid from 'uuid';
import { Redis } from 'ioredis';

import { validate } from '@navch/codec';

export type PusherChannel = t.TypeOf<typeof PusherChannel>;
const PusherChannel = t.type({
  id: t.string,
  createdAt: t.number,
});

export async function upsert(redis: Redis): Promise<PusherChannel> {
  const record = validate({ id: uuid.v4(), createdAt: Date.now() }, PusherChannel);
  await redis.set(record.id, JSON.stringify(record), 'EX', 3600);
  return record;
}

export async function findById(redis: Redis, channelId: string): Promise<PusherChannel | undefined> {
  const record = await redis.get(channelId);
  if (!record) {
    return undefined;
  }
  return validate(JSON.parse(record), PusherChannel);
}
