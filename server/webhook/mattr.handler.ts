import * as t from 'io-ts';
import * as R from 'ramda';
import * as uuid from 'uuid';
import Redis from 'ioredis';
import Pusher from 'pusher';

import { thread } from '@navch/common';
import { instanceOf } from '@navch/codec';
import { makeHandler, makeHandlers } from '@navch/http';

import * as pusherRepo from '../subscription/pusher.repository';
import * as pusherAdapter from '../subscription/pusher.adapter';

const HandlerContext = t.type({
  pusher: t.union([instanceOf(Pusher), t.null]),
  pusherRedis: instanceOf(Redis),
});

const postWebhookEvent = makeHandler({
  route: '/webhook/mattr/events/:channelId?',
  method: 'POST',
  input: {
    params: t.type({ channelId: t.union([t.undefined, t.string]) }),
    body: t.type({ event: t.unknown }),
  },
  context: HandlerContext,
  handle: async ({ channelId }, body, { pusherRedis, pusher, logger, headers, path }) => {
    const { signature } = headers;
    const successResponse = { status: 'Ok' };
    logger.info('Received mattr event', { path, body, signature });

    // Parse and validate the HTTP signature
    //
    if (typeof signature !== 'string') {
      logger.warn('Missing request signature, completing request');
      return successResponse; // silently
    }

    // Verify signature with `http-digest-header`
    //
    // @ts-ignore:next-line
    const { verifyHeaderValue } = await import('@digitalbazaar/http-digest-header');
    const verified = await verifyHeaderValue({ data: body, headerValue: signature });
    logger.info('Verified http signature', verified);

    const signatureParams = thread(
      signature,
      R.split(','),
      R.map(v => v.split('=', 2) as [string, string]),
      R.fromPairs,
      R.mapObjIndexed(R.replace(/^\"?(.+?)\"?$/, '$1'))
    );
    logger.debug('Parsed signature', signatureParams);

    // Forward event to PubSub service if enabled
    //
    if (pusher && channelId && uuid.validate(channelId)) {
      await pusherAdapter.publish(pusherRedis, pusher, {
        channelId,
        event: 'WEBHOOK_MATTR_EVENT',
        data: { event: body.event, signature },
      });
    }
    return successResponse;
  },
});

const postChannelRegister = makeHandler({
  route: '/webhook/mattr/channels',
  method: 'POST',
  context: HandlerContext,
  handle: async (_1, _2, { pusherRedis, logger }) => {
    logger.info('Register pusher channel');
    return await pusherRepo.upsert(pusherRedis);
  },
});

export const handlers = makeHandlers(() => [postWebhookEvent, postChannelRegister]);
