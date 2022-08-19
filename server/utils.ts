import * as t from 'io-ts';
import got, { HTTPError } from 'got';
import { URL } from 'url';

import { MaybePromise, Logger } from '@navch/common';

const NgrokResponse = t.type({
  tunnels: t.array(t.type({ proto: t.string, public_url: t.string })),
});

export async function resolvePublicURL(url: string): Promise<string> {
  const { port, protocol, hostname } = new URL(url);

  if (protocol === 'ngrok:') {
    const request = got(`http://${hostname}:${port}/api/tunnels`, {
      retry: 0,
      timeout: 500,
    });
    const resp = await request.json().catch((err: HTTPError) => {
      const message = err.response?.body ?? err.message;
      throw new Error(`Failed to fetch Ngrok tunnel: ${message}`);
    });
    if (!NgrokResponse.is(resp)) {
      throw new Error(`Invalid Ngrok API response from ${url}`);
    }
    const tunnel = resp.tunnels.find(a => a.proto === 'https');
    if (!tunnel) {
      throw new Error(`Ngrok HTTPS tunnel is not available`);
    }
    return tunnel.public_url;
  }

  return url;
}

type GracefulErrorHandler = (error: Error) => MaybePromise<void>;

export async function graceful<T>(
  p: MaybePromise<T>,
  handler?: GracefulErrorHandler | Logger
): Promise<T | undefined> {
  try {
    return await p;
  } catch (err) {
    if (handler instanceof Function) {
      await handler(err);
    } else {
      const logger = handler || Logger;
      logger.error('Graceful failure', { err });
    }
    return undefined;
  }
}
