import { KeyObject, createPublicKey } from 'node:crypto';
import { IncomingMessage } from 'node:http';

import * as t from '@navch/codec';
import { Logger } from '@navch/common';

const Ed25519JsonWebKey = t.type({
  kty: t.literal('OKP'),
  crv: t.literal('Ed25519'),
  x: t.string,
  kid: t.string,
});

export type SignatureScheme = t.TypeOf<typeof SignatureScheme>;
export const SignatureScheme = t.type({
  /**
   * HTTP Signature scheme
   */
  scheme: t.union([t.undefined, t.literal('httpbis'), t.literal('httpbis-12')], 'signature scheme'),
  /**
   * A list of trusted sender public keys in JWK format.
   */
  jwks: t.array(Ed25519JsonWebKey, 'public keys'),
  /**
   * By default, the `Authorization` header value will be validated. This option
   * allows you to use an alternative header field, value must be in lower-case.
   */
  authorizationHeaderName: t.union([t.undefined, t.string], 'authz header name'),
});

export type VerifySignatureOptions = {
  readonly logger: Logger;
  readonly scheme: SignatureScheme;
  readonly request: IncomingMessage;
  readonly body?: unknown;
};

export type VerifyResult = {
  readonly verified: boolean;
  readonly reason?: string;
  readonly parsed?: Record<string, unknown>;
};

export async function verifySignature(options: VerifySignatureOptions): Promise<VerifyResult> {
  switch (options.scheme.scheme) {
    case 'httpbis':
      return verifySignatureDraft12(options);
    case 'httpbis-12':
      return verifySignatureDraft12(options);
    default:
      return verifySignatureStandard(options);
  }
}

async function verifySignatureStandard(options: VerifySignatureOptions): Promise<VerifyResult> {
  const { request, scheme } = options;
  const logger = options.logger.child({ name: 'Joyent scheme' });

  // The library doesn't provide type definitions :(
  // @ts-ignore:next-line
  const httpSignature = await import('http-signature');

  try {
    const parsed = httpSignature.parseRequest(request, {
      authorizationHeaderName: scheme.authorizationHeaderName,
    });
    logger.debug('Parsed http signature', parsed);

    /**
     * The `node-http-signature` library uses `sshpk` to verify the signatures,
     * which does not support JWK format, we need to first convert it to PEM.
     */
    const keyPub = findPublicKey(scheme, parsed?.params?.keyId);
    const keyPubPem = keyPub.export({ type: 'spki', format: 'pem' });

    /**
     * For signatures with hidden algorithm (HS2019), we have forked the library
     * to support inferring the algorithm from publike key type.
     *
     * Alternatively, you could explicitly instruct which algorithm to use:
     *
     * @example
     * httpSignature.verifySignature(parsed, keyPubPem, {
     *   overriddenAlgorithm: 'ed25519-sha512'
     * })
     *
     * NOTE: Ed25519 is using SHA-256 and Curve25519
     *
     * @see https://tools.ietf.org/html/draft-cavage-http-signatures
     * @see https://github.com/TritonDataCenter/node-http-signature/blob/master/http_signing.md#signing-algorithms
     *
     * @see https://github.com/zhenwenc/node-http-signature/pull/1
     */
    const verified = httpSignature.verifySignature(parsed, keyPubPem);
    logger.info('Verified http signature', { verified });

    return { verified, parsed, reason: 'Invalid signature' };
  } catch (err) {
    logger.debug('Failed to verify http signature', err);
    return { verified: false, reason: err.message };
  }
}

async function verifySignatureDraft12(options: VerifySignatureOptions): Promise<VerifyResult> {
  const { request, scheme } = options;
  const logger = options.logger.child({ name: 'IETF draft scheme 12' });

  const httpSignatures = await import('@mattrglobal/http-signatures');

  try {
    const keyMap = scheme.jwks.reduce((acc, jwk) => {
      return jwk.kid ? { ...acc, [jwk.kid]: { key: jwk } } : acc;
    }, {});

    logger.info('Verifing http signature', { keyMap });
    const result = await httpSignatures.verifyRequest({
      verifier: { keyMap },
      request,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (result.isErr()) throw result.error;

    logger.info('Verified http signature', { verified: result.value });
    return { verified: result.value };
  } catch (err) {
    logger.debug('Failed to verify http signature', err);
    return { verified: false, reason: err.message };
  }
}

function findPublicKey(scheme: SignatureScheme, keyId: string): KeyObject {
  const publicKey = scheme.jwks.find(v => v.kid === keyId);
  if (!publicKey) {
    throw new Error(`No public key found with kid=${keyId}`);
  }
  return createPublicKey({ format: 'jwk', key: publicKey });
}
