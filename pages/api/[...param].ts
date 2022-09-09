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
  return middlewares.runMiddleware(req, res, routes);
}
export default handler;
