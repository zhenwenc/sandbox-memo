import { Redis } from 'ioredis';

import * as t from '@navch/codec';

export type PresentationRecord = t.TypeOf<typeof PresentationRecord>;
export const PresentationRecord = t.type({
  id: t.string,
  receivedAt: t.number,
  data: t.unknown,
});

export async function insertPresentation<T>(redis: Redis, id: string, data: T): Promise<T> {
  const key = `presentation:${id}`;
  const record = { id, receivedAt: Date.now(), data };
  await redis.set(key, JSON.stringify(record), 'EX', 300);
  return record.data;
}

export async function findPresentationById(
  redis: Redis,
  id: string
): Promise<PresentationRecord | undefined> {
  const record = await redis.get(`presentation:${id}`);
  if (!record) {
    return undefined;
  }
  return t.validate(PresentationRecord, JSON.parse(record));
}
