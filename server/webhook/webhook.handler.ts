import Redis from 'ioredis';

import * as t from '@navch/codec';
import { sleep } from '@navch/common';
import { makeHandler, makeHandlers } from '@navch/http';

import * as pusherAdapter from '../subscription/pusher.adapter';
import * as webhookRepo from './webhook.repository';
import * as influxdbModule from '../telemetry/influxdb';
import * as signatures from './signature';
import { WebhookMetadata } from './webhook.repository';
import { schemes } from './scheme';

const HandlerContext = t.type({
  redis: t.type({
    pusher: t.instanceOf(Redis),
    webhook: t.instanceOf(Redis),
  }),
  influxdb: t.instanceOf(influxdbModule.InfluxClientPool),
  pusher: t.instanceOf(pusherAdapter.PusherConnectionPool),
});

const postChannelRegister = makeHandler({
  route: '/v1/webhook/channels',
  method: 'POST',
  input: { body: WebhookMetadata },
  context: HandlerContext,
  handle: async (_1, metadata, { redis, logger, request }) => {
    const { protocol, host } = request;
    logger.info('Register webhook channel', metadata);

    const channel = await webhookRepo.insert(redis.webhook, metadata);
    const result = {
      ...channel,
      callbackURL: `${protocol}://${host}/webhook/events/${channel.id}`,
    };
    logger.info('Registered webhook channel', result);
    return result;
  },
});

/**
 * This is a _public_ callback endpoint for receiving webhook notifications.
 *
 * It supports forwarding the received events and signature verification results to a
 * registered pub/sub channel, the request must be authenticated with HTTP signature
 * using the configured signature scheme.
 *
 * See also {@link https://hookdeck.com/}
 */
const postWebhookEvent = makeHandler({
  route: '/v1/webhook/events/:channelId?',
  method: 'POST',
  input: {
    params: t.type({
      channelId: t.union([t.undefined, t.string]),
    }),
    body: t.unknown,
  },
  context: HandlerContext,
  handle: async ({ channelId }, body, { redis, pusher, influxdb, logger, headers, path, req }) => {
    const { signature } = headers;
    logger.info('Received webhook event', { path, body, headers, signature });

    const channel = channelId ? await webhookRepo.findById(redis.pusher, channelId) : undefined;
    const metadata = channel ? t.validate(WebhookMetadata, channel.metadata) : undefined;
    const scheme = schemes.find(s => s.isEventBody(body));

    //
    // Verify signature against the configured scheme
    //
    let verifyResult: signatures.VerifyResult | undefined = undefined;
    if (channelId && metadata && metadata.signature) {
      verifyResult = await signatures.verifySignature({
        logger,
        body,
        request: req,
        scheme: metadata.signature,
      });
      if (!verifyResult.verified) {
        logger.warn('Unable to verify signature', verifyResult);
      }
    }
    //
    // Send telemetry data if configured
    //
    if (channel && metadata?.influxdb && scheme?.isEventBody(body)) {
      logger.debug('Send telemetry data to InfluxDB');
      const pointBuilder = scheme.influxdb.pointBuilder({ body, channel });
      influxdb.writePoint(metadata.influxdb, 'webhook_event', pointBuilder);
    }
    //
    // Forward event to PubSub service if enabled
    //
    if (channel && metadata?.pusher && scheme) {
      logger.debug('Publishing event to Pusher');
      await pusher.publish(metadata.pusher, {
        channel,
        event: scheme.pusher.eventType,
        data: { body, signature, verifyResult },
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

const postPresentationResponse = makeHandler({
  route: '/v1/webhook/presentations',
  method: 'POST',
  input: { body: t.unknown },
  context: HandlerContext,
  handle: async (_, body, { redis, logger }) => {
    logger.info('Received presentation response', { body });
    for (const scheme of schemes) {
      //
      // Persist W3C presentation response
      //
      if (scheme.isPresentationBody(body)) {
        logger.info('Persist presentation response');
        await webhookRepo.insertPresentation(redis.webhook, scheme.presentation.uid(body), body);
      }
    }
    return { status: 'OK' };
  },
});

const getPresentationResponse = makeHandler({
  route: '/v1/webhook/presentations/:challengeId',
  method: 'GET',
  input: { params: t.type({ challengeId: t.string }) },
  context: HandlerContext,
  handle: async ({ challengeId }, _2, { redis }) => {
    const record = await webhookRepo.findPresentationById(redis.webhook, challengeId);
    return { value: record };
  },
});

export const handlers = makeHandlers(() => [
  postWebhookEvent,
  postChannelRegister,
  postPresentationResponse,
  getPresentationResponse,
]);
