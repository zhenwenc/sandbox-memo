import { BaseConfig, Option } from '@navch/common';

import { resolvePublicURL } from './utils';

export class AppConfig extends BaseConfig {
  readonly port = this.readNumber('PORT', 3000);

  readonly redisURI = this.read('REDIS_URI');
  readonly pusherURI = this.read('PUSHER_URI', null);

  readonly vercelURL = Option.of(this.read('VERCEL_URL', null));
  readonly publicURL = Option.of(this.read('PUBLIC_URL', null))
    .orElse(() => this.vercelURL.map(domain => `https://${domain}`))
    .map(resolvePublicURL)
    .getOrElse(Promise.resolve(`http://localhost:${this.port}`));
}
