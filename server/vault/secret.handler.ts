import Redis from 'ioredis';
import { last } from 'ramda';

import * as t from '@navch/codec';
import { makeHandler, makeHandlers } from '@navch/http';
import { BadRequestError, NotFoundError, InternalServerError } from '@navch/common';

type HandlerContext = t.TypeOf<typeof HandlerContext>;
const HandlerContext = t.type({
  /**
   * The storage to persist the secrets.
   */
  redis: t.type({ vault: t.instanceOf(Redis) }),
});

type StoredRecord = t.TypeOf<typeof StoredRecord>;
const StoredRecord = t.type({
  /**
   * The key of the secret.
   */
  key: t.string,
  /**
   * The path of the secret.
   */
  path: t.string,
  /**
   * An optional JSON data.
   */
  data: t.unknown,
});

const KeyScheme = {
  list: (path: string) => `*${path}/*`,
  secret: (path: string, key: string) => `${path}/${key}`,
};

const ExpiryScheme = {
  initial: 14 * 86400, // 24h
  refresh: 14 * 86400, // 24h
};

/**
 * The endpoint returns a list of key names at the specified location.
 *
 * https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2#list-secrets
 */
const listMetadata = makeHandler({
  route: '/vault/v1/secret/metadata/:path',
  input: {
    params: t.type({ path: t.string }),
  },
  context: HandlerContext,
  handle: async ({ path }, _, { method, redis, logger }) => {
    // Koa router does not support LIST method
    if (method === 'GET' || method === 'LIST') {
      const cacheKeys = await redis.vault.keys(KeyScheme.list(path));
      const keys = cacheKeys.map(key => last(key.split('/')));

      logger.info('List metadata', { path, keys, cacheKeys });
      return { data: { keys } };
    }
    throw new BadRequestError(`Unsupported request method: ${method}`);
  },
});

/**
 * This endpoint issues a soft delete of the specified versions of the secret.
 *
 * https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2#create-update-secret
 */
const deleteMetadata = makeHandler({
  route: '/vault/v1/secret/metadata/:path/:key',
  method: 'DELETE',
  input: {
    params: t.type({ path: t.string, key: t.string }),
  },
  context: HandlerContext,
  handle: async ({ path, key }, _, { redis, logger }) => {
    const cacheKey = KeyScheme.secret(path, key);
    logger.debug('Deleted secret', { path, key });

    const value = await redis.vault.get(cacheKey);
    if (!value) {
      throw new NotFoundError(`No secret found at path ${path} with key ${key}`);
    }

    const resp = await redis.vault.del(cacheKey);
    logger.info('Deleted secret', { path, key, value, resp });

    return {
      versions: [], // TODO
    };
  },
});

/**
 * This endpoint creates a new version of a secret at the specified location.
 *
 * https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2#create-update-secret
 */
const createSecret = makeHandler({
  route: '/vault/v1/secret/data/:path/:key',
  method: 'POST',
  input: {
    params: t.type({ path: t.string, key: t.string }),
    body: t.type({ data: t.unknown }),
  },
  context: HandlerContext,
  handle: async ({ path, key }, { data }, { redis, logger }) => {
    const now = new Date();
    const cacheKey = KeyScheme.secret(path, key);

    const record: StoredRecord = { key, path, data };
    const value = JSON.stringify(record);
    await redis.vault.set(cacheKey, value, 'EX', ExpiryScheme.initial);

    logger.info('Created secret', record);
    return {
      data: {
        version: 0, // TODO
        created_time: now.toISOString(),
      },
    };
  },
});

/**
 * This endpoint retrieves the secret at the specified location.
 *
 * https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2#read-secret-version
 */
const getSecret = makeHandler({
  route: '/vault/v1/secret/data/:path/:key',
  method: 'GET',
  input: {
    params: t.type({ path: t.string, key: t.string }),
  },
  context: HandlerContext,
  handle: async ({ path, key }, _, { redis, logger }) => {
    const cacheKey = KeyScheme.secret(path, key);
    logger.debug('Resolve secret', { path, key });

    const value = await redis.vault.get(cacheKey);
    if (!value) {
      throw new NotFoundError(`No secret found at path ${path} with key ${key}`);
    }

    try {
      const record = t.validate(StoredRecord, JSON.parse(value));
      logger.info('Resolved secret', { path, key, record });

      await redis.vault.expire(cacheKey, ExpiryScheme.refresh); // extend TTL

      return { data: { data: record.data } };
    } catch (err) {
      throw new InternalServerError('Malformed secret record', err);
    }
  },
});

export const handlers = makeHandlers(() => [listMetadata, createSecret, getSecret, deleteMetadata]);
