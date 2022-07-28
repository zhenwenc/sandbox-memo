import * as t from 'io-ts';
import * as R from 'ramda';
import { v4 as uuid } from 'uuid';
import Redis from 'ioredis';

import { thread } from '@navch/common';
import { instanceOf } from '@navch/codec';
import { makeHandler, makeHandlers } from '@navch/http';

export type HandlerContext = t.TypeOf<typeof HandlerContext>;
export const HandlerContext = t.type({
  /**
   * The storage to persist the received data.
   */
  redis: instanceOf(Redis),
});

type StoredRecord = t.TypeOf<typeof StoredRecord>;
const StoredRecord = t.type({ data: t.unknown });

const receiveDidCommMessage = makeHandler({
  route: '/webhook/mattr/events/:uid?',
  method: 'POST',
  input: {
    params: t.type({ uid: t.union([t.undefined, t.string]) }),
    body: t.type({ event: t.unknown }),
  },
  context: HandlerContext,
  handle: async ({ uid }, body, { redis, logger, headers, path }) => {
    const recordId = [uid ?? 'root', uuid()].join('_').toLowerCase();
    const { signature } = headers;

    logger.info('[webhook] Received mattr event', { recordId, path, body, signature });
    if (typeof signature !== 'string') {
      logger.error('Missing request signature');
      return 'Ok'; // silently
    }

    // NOTE: The `http-digest-header` is written in native ESM format
    //
    // const { verifyHeaderValue } = require('@digitalbazaar/http-digest-header');
    // const verified = await verifyHeaderValue({ data: body, headerValue: signature });
    // logger.info('Signature verification result', verified);

    const signatureParams = thread(
      signature,
      R.split(','),
      R.map(v => v.split('=', 2) as [string, string]),
      R.fromPairs,
      R.mapObjIndexed(R.replace(/^\"?(.+?)\"?$/, '$1'))
    );
    logger.info('[webhook] Parsed signature', signatureParams);

    const record: StoredRecord = { data: { event: body.event } };
    const value = JSON.stringify(record);
    await redis.set(recordId, value, 'EX', 120);

    return 'Ok';
  },
});

export const handlers = makeHandlers(() => [receiveDidCommMessage]);
