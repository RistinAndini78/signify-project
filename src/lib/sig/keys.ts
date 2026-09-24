import { KeyObject, createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, scryptSync, sign, verify } from 'node:crypto';
import { FormatError, b64u, fromB64u, sha256hex } from './encoding';

// ECDSA P-256 with SHA-256. Signatures are IEEE P1363 (r || s), always 64 bytes.
export const SIG_LEN = 64;
export const PUB_LEN = 65; // uncompressed point: 0x04 || x || y

export function generateKeyPair(): { privateKey: KeyObject; publicKey: KeyObject } {
  return generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
}

export function rawPublic(pub: KeyObject): Buffer {
  const jwk = pub.export({ format: 'jwk' });
  return Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')]);
}

/** Public key from the 65-byte point. Node refuses a point that is not on the curve. */
export function publicFromRaw(raw: Buffer): KeyObject {
  if (raw.length !== PUB_LEN || raw[0] !== 4) throw new FormatError('bad public key');
  try {
    return createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(raw.subarray(1, 33)), y: b64u(raw.subarray(33)) }, format: 'jwk' });
  } catch {
    throw new FormatError('bad public key');
  }
}

/** Public key from PEM (SPKI) text, or from the base64url raw point. */
export function parsePublicKey(text: string): KeyObject {
  const t = text.trim();
  try {
    return t.includes('BEGIN PUBLIC KEY') ? createPublicKey(t) : publicFromRaw(fromB64u(t));
  } catch {
    throw new FormatError('bad public key');
  }
}

export const fingerprint = (raw: Buffer): string => sha256hex(raw).slice(0, 16);

export function signMessage(privateKey: KeyObject, message: string): Buffer {
  return sign('sha256', Buffer.from(message, 'utf8'), { key: privateKey, dsaEncoding: 'ieee-p1363' });
}

export function verifyMessage(publicKey: KeyObject, message: string, signature: Buffer): boolean {
  if (signature.length !== SIG_LEN) return false;
  try {
    return verify('sha256', Buffer.from(message, 'utf8'), { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature);
  } catch {
    return false;
  }
}

// ---- private key at rest: PKCS#8 sealed with AES-256-GCM under a scrypt key from the passphrase ----
export class PassphraseError extends Error {
  constructor() {
    super('wrong passphrase or damaged key file');
  }
}

const KDF = { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
export interface Sealed { salt: string; nonce: string; ct: string; tag: string }

const aad = (fp: string) => Buffer.from(`KRIPTO-KEY1|${fp}`);

export function sealPrivateKey(privateKey: KeyObject, fp: string, passphrase: string): Sealed {
  const salt = randomBytes(16), nonce = randomBytes(12);
  const key = scryptSync(passphrase.normalize('NFKC'), salt, 32, KDF);
  const c = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  c.setAAD(aad(fp));
  const ct = Buffer.concat([c.update(privateKey.export({ format: 'der', type: 'pkcs8' })), c.final()]);
  return { salt: b64u(salt), nonce: b64u(nonce), ct: b64u(ct), tag: b64u(c.getAuthTag()) };
}

export function openPrivateKey(s: Sealed, fp: string, passphrase: string): KeyObject {
  try {
    const key = scryptSync(passphrase.normalize('NFKC'), fromB64u(s.salt), 32, KDF);
    const d = createDecipheriv('aes-256-gcm', key, fromB64u(s.nonce), { authTagLength: 16 });
    d.setAAD(aad(fp));
    d.setAuthTag(fromB64u(s.tag));
    const der = Buffer.concat([d.update(fromB64u(s.ct)), d.final()]);
    return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  } catch {
    throw new PassphraseError();
  }
}
