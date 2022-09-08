import crypto from 'crypto';
import * as uuid from 'uuid';

type CacheKey = Record<string, unknown> | string;

type ConnectionInstance<K, T> = {
  readonly key: K;
  readonly instance: T;
  readonly lastActivityAt: Date;
};

export abstract class ConnectionPool<K extends CacheKey, T> {
  readonly instanceId = uuid.v4();
  readonly instances = new Map<string, ConnectionInstance<K, T>>();

  readonly maxCacheAgeMs = 30_000;

  abstract initInstance(key: K): T;
  abstract releaseInstance(key: K, instance: T): Promise<void>;

  protected getCacheKey(key: K): string {
    // TODO normalize with `canonicalize`
    return crypto.createHash('sha256').update(JSON.stringify(key)).digest('base64');
  }

  protected setInstance(key: K, instance: T): void {
    const cacheKey = this.getCacheKey(key);
    // Remembers instances for consecutive requests, and renew the last
    // activity timestamp.
    this.instances.set(cacheKey, { key, instance, lastActivityAt: new Date() });
  }

  protected getInstance(key: K): T {
    const cacheKey = this.getCacheKey(key);
    let instance = this.instances.get(cacheKey)?.instance;
    if (!instance) {
      instance = this.initInstance(key);
      this.setInstance(key, instance);
    }
    return instance;
  }

  async invalidateExpiredItems(): Promise<void> {
    const minActivityTimestamp = Date.now() - this.maxCacheAgeMs;

    for (const [cacheKey, { key, instance, lastActivityAt }] of this.instances) {
      if (lastActivityAt.getTime() < minActivityTimestamp) {
        this.instances.delete(cacheKey);
        this.releaseInstance(key, instance);
      }
    }
  }
}
