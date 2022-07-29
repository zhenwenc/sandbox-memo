import Pusher from 'pusher';
import { Redis } from 'ioredis';

import { HttpStatus, AbstractError, Logger } from '@navch/common';

import * as pusherRepo from '../subscription/pusher.repository';
import { AppConfig } from '../config';

type EventKind = 'WEBHOOK_MATTR_EVENT';

const ServiceLogger = new Logger({ name: 'subscription', prettyPrint: true });

export class PusherPublishError extends AbstractError {
  readonly status = HttpStatus.BAD_REQUEST;
  readonly code = 'PUSHER_PUBLISH_ERROR';
  constructor(err: string | Error) {
    super(`Failed to send pusher event: ${err}`);
    Object.setPrototypeOf(this, new.target.prototype);
    Object.defineProperty(this, 'name', { value: PusherPublishError.name });
  }
}

export function init(config: AppConfig): Pusher | null {
  if (!config.pusherURI) return null;
  return Pusher.forURL(config.pusherURI);
}

export type PusherSendRequest<T> = {
  readonly channelId: string;
  readonly event: EventKind;
  readonly data: T;
};
export async function publish<T>(redis: Redis, pusher: Pusher, req: PusherSendRequest<T>): Promise<unknown> {
  const { channelId, event, data } = req;
  try {
    const channel = await pusherRepo.findById(redis, channelId);
    if (!channel) {
      ServiceLogger.debug('Skipped publishing event, no channel found');
      return;
    }

    const res = await pusher.trigger(`private-${channel.id}`, event, data);
    if (res.status !== HttpStatus.OK) {
      throw new PusherPublishError('unexpected response status');
    }
    ServiceLogger.debug('Publish event to pusher');
    return await res.json();
  } catch (err) {
    ServiceLogger.debug('Failed to publish event', { err });
    throw new PusherPublishError(err);
  }
}
