import { NextApiRequest, NextApiResponse } from 'next';

import { middlewares } from '@navch/http';

import { buildHandler } from '../../server';

// @ts-ignore:next-line
import 'pino-logdna';

export const config = {
  api: {
    bodyParser: false,
  },
};

const server = buildHandler();
const routes = middlewares.toCallback(server.routes());
async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.info('-- DEBUG --', process.env.NODE_ENV, process.env.PINO_LOGDNA_INGESTION_KEY?.substring(0, 5));
  return middlewares.runMiddleware(req, res, routes);
}
export default handler;
