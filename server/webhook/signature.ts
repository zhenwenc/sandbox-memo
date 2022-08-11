import { IncomingMessage } from 'http';
import { JsonWebKey, createPublicKey } from 'crypto';

import { Logger } from '@navch/common';

/**
 * A list of trusted sender public keys in JWK format.
 */
const JWKS: JsonWebKey[] = [
  {
    kty: 'OKP',
    crv: 'Ed25519',
    x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo',
    kid: 'FdFYFzERwC2uCBB46pZQi4GG85LujR8obt-KWRBICVQ',
  },
];

export type VerifySignatureOptions = {
  readonly logger: Logger;
  readonly request: IncomingMessage;
};

export type VerifyResult = {
  readonly verified: boolean;
  readonly reason: string;
  readonly parsed?: Record<string, unknown>;
};

export async function verifySignature(options: VerifySignatureOptions): Promise<VerifyResult> {
  const { request } = options;
  const logger = options.logger.child({ name: 'Joyent scheme' });

  // The library doesn't provide type definitions :(
  // @ts-ignore:next-line
  const httpSignature = await import('http-signature');

  try {
    const parsed = httpSignature.parseRequest(request, {
      authorizationHeaderName: 'signature',
    });
    logger.debug('Parsed http signature', parsed);

    // Lookup key id from signature components
    const keyId = parsed?.params?.keyId;

    const publicKey = JWKS.find(v => v.kid === keyId);
    if (!publicKey) {
      throw new Error(`No imported public key found with kid=${keyId}`);
    }

    /**
     * The `node-http-signature` library uses `sshpk` to verify the signatures,
     * which does not support JWK format, we need to first convert it to PEM.
     */
    const keyPub = createPublicKey({ format: 'jwk', key: publicKey });
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
    logger.error('Failed to verify http signature', err);
    return { verified: false, reason: err.message };
  }
}

export async function verifySignatureDraft(options: VerifySignatureOptions) {
  const { request } = options;
  const logger = options.logger.child({ name: 'IETF draft scheme' });

  const signature = `keyId="Test",algorithm="rsa-sha256",\ncreated=1402170695, expires=1402170699,\nheaders="(request-target) (created) (expires) host date content-type digest content-length",\nsignature="vSdrb+dS3EceC9bcwHSo4MlyKS59iFIrhgYkz8+oVLEEzmYZZvRs8rgOp+63LEM3v+MFHB32NfpB2bEKBIvB1q52LaEUHFv120V01IL+TAD48XaERZFukWgHoBTLMhYS2Gb51gWxpeIq8knRmPnYePbF5MOkR0Zkly4zKH7s1dE="`;

  // The library doesn't provide type definitions :(
  // @ts-ignore:next-line
  const httpSignature = await import('@digitalbazaar/http-digest-header');

  try {
    const parsedSampleSignature = await await httpSignature.parseSignatureHeader(signature);
    logger.info('------- parsedSampleSignature', parsedSampleSignature);

    const parsed = await httpSignature.parseRequest(request, {
      authorizationHeaderName: 'signature',
    });
    logger.debug('Parsed http signature', parsed);

    // return { verified: false, parsed, reason: 'Invalid signature' };
  } catch (err) {
    logger.error('Failed to verify http signature', err);
    // return { verified: false, reason: err.message };
  }
}
