import { createHash } from 'node:crypto';

export class FormatError extends Error {}

export const b64u = (b: Buffer | Uint8Array): string => Buffer.from(b).toString('base64url');
export const sha256hex = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

/** Canonical base64url only: anything that would not re-encode to the same text is refused, so a flipped byte can never decode to the same data. */
export function fromB64u(s: string): Buffer {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new FormatError('not base64url');
  const b = Buffer.from(s, 'base64url');
  if (b.toString('base64url') !== s) throw new FormatError('non-canonical base64url');
  return b;
}
