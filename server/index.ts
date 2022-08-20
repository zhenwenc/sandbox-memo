import Redis from 'ioredis';
import morgan from 'morgan';
import { compose, trim } from 'ramda';

import { Logger } from '@navch/common';
import { makeRouter, middlewares, setRequestContext } from '@navch/http';

import { AppConfig } from './config';
import * as influxdbModule from './telemetry/influxdb';
import * as shorten from './shorten/shorten.handler';
import * as webhookMattr from './webhook/mattr.handler';
import * as pusherAdapter from './subscription/pusher.adapter';

export function buildHandler() {
  const config = new AppConfig();
  const logger = new Logger({
    name: 'memo',
    prettyPrint: {
      ignore: 'time,pid,hostname,transport,hooks',
    },
  });

  const requestLogger = morgan('dev', {
    stream: { write: compose(logger.debug, trim) },
  });

  const router = makeRouter();
  router.use(setRequestContext({ logger }));
  router.use(middlewares.fromCallback(requestLogger));

  const redis = {
    shorten: new Redis(config.redisURI, {
      keyPrefix: 'sandbox:memo:shorten:',
      showFriendlyErrorStack: true,
      keepAlive: 5000,
      lazyConnect: true,
    }),
    pusher: new Redis(config.redisURI, {
      keyPrefix: 'sandbox:memo:pusher:',
      showFriendlyErrorStack: true,
      keepAlive: 5000,
      lazyConnect: true,
    }),
  };

  const influxdb = new influxdbModule.InfluxClientPool();

  {
    const setContext = setRequestContext(async () => {
      const publicURL = await config.publicURL;
      return { logger, publicURL, redis };
    });
    router.use(middlewares.errorHandler({ logger, expose: true }));
    router.use('/api', setContext, makeRouter(shorten.handlers()).routes());
  }
  {
    const pusher = pusherAdapter.init(config);
    const setContext = setRequestContext(async () => {
      return { logger, pusher, redis, influxdb };
    });
    router.use(middlewares.errorHandler({ logger: logger.child({ name: 'webhook' }), expose: true }));
    router.use('/api', setContext, makeRouter(webhookMattr.handlers()).routes());
  }

  return router;
}
