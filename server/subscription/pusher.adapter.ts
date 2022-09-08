import Pusher from 'pusher';

import * as t from '@navch/codec';
import { HttpStatus, AbstractError, Logger } from '@navch/common';

import { AppConfig } from '../config';
import { PusherChannel } from '../subscription/pusher.repository';

const ServiceLogger = new Logger({ name: 'pusher' });

export type ClientOptions = t.TypeOf<typeof ClientOptions>;
export const ClientOptions = t.strict({
  /**
   * Pusher server URI. Must be in format:
   *
   * https://{username}:{token}@api-{region}.pusher.com/apps/{appId}
   */
  url: t.string,
});

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

export function forURL(uri: string): Pusher {
  return Pusher.forURL(uri);
}

export type PusherSendRequest<T> = {
  readonly channel: PusherChannel;
  readonly event: string;
  readonly data: T;
};
export async function publish<T>(pusher: Pusher, req: PusherSendRequest<T>): Promise<unknown> {
  const { channel, event, data } = req;
  try {
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
