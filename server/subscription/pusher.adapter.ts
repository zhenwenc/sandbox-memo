import Pusher from 'pusher';

import * as t from '@navch/codec';
import { HttpStatus, AbstractError, Logger } from '@navch/common';

import { AppConfig } from '../config';
import { ConnectionPool } from '../interfaces/ConnectionPool';
import { WebhookChannel } from '../webhook/webhook.repository';

const ServiceLogger = new Logger({ name: 'pusher' });

export type PusherClientMetadata = t.TypeOf<typeof PusherClientMetadata>;
export const PusherClientMetadata = t.strict({
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
  readonly channel: WebhookChannel;
  readonly event: string;
  readonly data: T;
};

export type PusherAuthRequest = {
  readonly channel: WebhookChannel;
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

export class PusherConnectionPool extends ConnectionPool<PusherClientMetadata, Pusher> {
  public initInstance(options: PusherClientMetadata): Pusher {
    return Pusher.forURL(options.url);
  }

  async releaseInstance(_: PusherClientMetadata, _client: Pusher) {
    // noop
  }

  async publish<T>(options: PusherClientMetadata, req: PusherSendRequest<T>): Promise<unknown> {
    const { channel, event, data } = req;
    try {
      const pusher = this.getInstance(options);
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

  async authorize(options: PusherClientMetadata, req: PusherAuthRequest): Promise<unknown> {
    const { channel } = req;
    try {
      const pusher = this.getInstance(options);
      const res = await pusher.authorizeChannel(`private-${channel.id}`);
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
}
