import { BaseConfig, Option } from '@navch/common';
import { resolveNgrokTunnel } from '@navch/http';

export class AppConfig extends BaseConfig {
  readonly port = this.readNumber('PORT', 3000);
  readonly basePath = this.read('BASE_PATH', '/memo');

  readonly redisURL = this.read('REDIS_URL');
  readonly pusherURI = this.read('PUSHER_URI', null);

  readonly vercelURL = Option.from(this.read('VERCEL_URL', null));
  readonly publicURL = Option.from(this.read('PUBLIC_URL', null))
    .orElse(() => this.vercelURL.map(domain => `https://${domain}`))
    .flatMap(u => resolveNgrokTunnel(u).orElse(() => Option.from(Promise.resolve(u))))
    .getOrElse(Promise.resolve(`http://localhost:${this.port}`));
}

export default new AppConfig();
