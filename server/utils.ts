import { MaybePromise, Logger } from '@navch/common';

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
