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
export async function verifySignature(options: VerifySignatureOptions) {
  const { logger, request } = options;

  // The library doesn't provide type definitions :(
  // @ts-ignore:next-line
  const httpSignature = await import('http-signature');

  try {
    const parsed = httpSignature.parseRequest(request, {
      authorizationHeaderName: 'signature',
    });
    logger.debug('Parsed http signature', parsed);

    // TODO lookup keyId
    const keyId = 'FdFYFzERwC2uCBB46pZQi4GG85LujR8obt-KWRBICVQ';

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
