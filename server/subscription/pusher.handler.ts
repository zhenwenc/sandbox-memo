import * as t from 'io-ts';
import * as R from 'ramda';
import Redis from 'ioredis';

import { thread } from '@navch/common';
import { instanceOf } from '@navch/codec';
import { makeHandler, makeHandlers } from '@navch/http';

import * as pusherRepo from '../subscription/pusher.repository';

export type HandlerContext = t.TypeOf<typeof HandlerContext>;
export const HandlerContext = t.type({
  /**
   * The storage to persist the received data.
   */
  redisPusherChannel: instanceOf(Redis),
});

const postWebhookEvent = makeHandler({
  route: '/webhook/mattr/events/:channelId?',
  method: 'POST',
  input: {
    params: t.type({ channelId: t.union([t.undefined, t.string]) }),
    body: t.type({ event: t.unknown }),
  },
  context: HandlerContext,
  handle: async ({ channelId }, body, { redisPusherChannel, logger, headers, path }) => {
    const { signature } = headers;
    logger.info('[webhook] Received mattr event', { path, body, signature });

    // Parse and validate the HTTP signature
    if (typeof signature !== 'string') {
      logger.error('Missing request signature');
      return 'Ok'; // silently
    } else {
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
      logger.debug('[webhook] Parsed signature', signatureParams);
    }

    // Forward event to PubSub service if enabled
    const channel = channelId ? await pusherRepo.findById(redisPusherChannel, channelId) : undefined;
    if (channel) {
      logger.debug('[webhook] Sent event to pusher');
    }

    return 'Ok';
  },
});

export const handlers = makeHandlers(() => [postWebhookEvent]);
