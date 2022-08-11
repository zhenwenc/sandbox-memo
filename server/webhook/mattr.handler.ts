import * as t from 'io-ts';
import * as uuid from 'uuid';
import Redis from 'ioredis';
import Pusher from 'pusher';

import { instanceOf } from '@navch/codec';
import { makeHandler, makeHandlers } from '@navch/http';

import * as pusherRepo from '../subscription/pusher.repository';
import * as pusherAdapter from '../subscription/pusher.adapter';
import * as signatures from './signature';

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
  handle: async ({ channelId }, body, { pusherRedis, pusher, logger, headers, path, req }) => {
    const { signature } = headers;
    const successResponse = { status: 'Ok' };
    logger.info('Received mattr event', { path, body, signature });

    // Verify signature against draft-cavage-http-signatures-12 scheme
    //
    // await verifySignatureDraft({ logger, request: req });

    // Verify signature against Joyent' scheme
    //
    const verifyResult = await signatures.verifySignature({ logger, request: req });
    if (!verifyResult.verified) {
      logger.warn('Failed to verify signature, completing request', verifyResult);
      return successResponse; // always success silently
    }

    // Forward event to PubSub service if enabled
    //
    if (pusher && channelId && uuid.validate(channelId)) {
      await pusherAdapter.publish(pusherRedis, pusher, {
        channelId,
        event: 'WEBHOOK_MATTR_EVENT',
        data: { event: body.event, signature, verifyResult },
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
