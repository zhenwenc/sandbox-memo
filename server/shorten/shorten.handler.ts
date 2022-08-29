import Redis from 'ioredis';
import base58 from 'bs58';
import { createHash } from 'crypto';

import * as t from '@navch/codec';
import { isNotNullish } from '@navch/common';
import { makeHandler, makeHandlers } from '@navch/http';

type HandlerContext = t.TypeOf<typeof HandlerContext>;
const HandlerContext = t.type({
  /**
   * The storage to persist the shortened URLs.
   */
  redis: t.type({ shorten: t.instanceOf(Redis) }),
});

type StoredRecord = t.TypeOf<typeof StoredRecord>;
const StoredRecord = t.type({
  /**
   * The original URL.
   */
  url: t.string,
  /**
   * An optional JSON data.
   */
  payload: t.unknown,
});

const hash = (data: string): string => {
  const shasum = createHash('sha1');
  shasum.update(data);
  return base58.encode(shasum.digest());
};

const resolveShortenURL = makeHandler({
  route: '/shorten/:code',
  input: {
    params: t.type({ code: t.string }),
  },
  context: HandlerContext,
  handle: async ({ code }, _, ctx) => {
    const value = await ctx.redis.shorten.get(code);
    if (!value) {
      throw new Error(`No shorten URL found with code: ${code}`);
    }
    const record = t.validate(StoredRecord, JSON.parse(value));
    ctx.logger.info('Resolved shorten URL:', record);

    if (isNotNullish(record.payload)) {
      return record.payload;
    } else {
      // TODO Fix this in handler
      ctx.redirect.bind(ctx)(record.url);
    }
  },
});

const createShortenURL = makeHandler({
  route: '/shorten',
  method: 'POST',
  input: {
    body: t.type({ long_url: t.string, payload: t.unknown }),
  },
  context: t.intersection([HandlerContext, t.type({ publicURL: t.string })]),
  handle: async (_, { long_url, payload }, { redis, publicURL }) => {
    const record: StoredRecord = { url: long_url, payload };
    const value = JSON.stringify(record);

    const code = hash(value);
    const link = `${publicURL}/api/shorten/${code}`;
    await redis.shorten.set(code, value, 'EX', 86400);

    return { link };
  },
});

export const handlers = makeHandlers(() => [resolveShortenURL, createShortenURL]);
