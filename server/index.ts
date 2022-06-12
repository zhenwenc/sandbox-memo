import Redis from 'ioredis';
import morgan from 'morgan';
import { compose, trim } from 'ramda';

import { Logger } from '@navch/common';
import { makeRouter, middlewares, setRequestContext } from '@navch/http';

import { AppConfig } from './config';
import * as shorten from './shorten/handler';
import * as webhookMattr from './webhook/mattr.handler';

export function buildHandler() {
  const config = new AppConfig();
  const logger = new Logger({ name: 'memo', prettyPrint: !config.isProdEnv });

  const requestLogger = morgan('dev', {
    stream: { write: compose(logger.debug, trim) },
  });

  const router = makeRouter();
  router.use(setRequestContext({ logger }));
  router.use(middlewares.fromCallback(requestLogger));

  {
    const redis = new Redis(config.redisURI, {
      keyPrefix: 'sandbox:memo:shorten:',
      showFriendlyErrorStack: true,
      keepAlive: 5000,
      lazyConnect: true,
    });
    const setContext = setRequestContext(async () => {
      const publicURL = await config.publicURL;
      return { logger, publicURL, redis };
    });
    router.use(middlewares.errorHandler({ logger, expose: true }));
    router.use('/api', setContext, makeRouter(shorten.handlers()).routes());
  }
  {
    const redis = new Redis(config.redisURI, {
      keyPrefix: 'sandbox:memo:webhook:',
      showFriendlyErrorStack: true,
      keepAlive: 5000,
      lazyConnect: true,
    });
    const setContext = setRequestContext(async () => {
      return { logger, redis };
    });
    router.use(middlewares.errorHandler({ logger, expose: true }));
    router.use('/api', setContext, makeRouter(webhookMattr.handlers()).routes());
  }

  return router;
}
