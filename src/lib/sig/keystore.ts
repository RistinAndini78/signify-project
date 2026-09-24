import { KeyObject, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { b64u } from './encoding';
import { Sealed, fingerprint, generateKeyPair, openPrivateKey, rawPublic, sealPrivateKey } from './keys';

export class VaultError extends Error {}

export interface PublicInfo { id: string; name: string; title: string; org: string; created: string; fp: string; publicKey: string }
interface Record extends PublicInfo { v: 1; sealed: Sealed }

const ID_RE = /^[0-9a-f]{16}$/;
export const MIN_PASSPHRASE = 10;
const clean = (label: string, v: unknown, max = 100): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  // eslint-disable-next-line no-control-regex
  if (!s || s.length > max || /[\u0000-\u001f\u007f]/.test(s)) throw new VaultError(`${label} must be 1 to ${max} characters without control characters`);
  return s;
};

/** Directory of key files: name, title, institution, public key, and the private key sealed with the passphrase. */
export class Keystore {
  constructor(readonly dir: string) {}

  private file(id: string): string {
    if (!ID_RE.test(id)) throw new VaultError('unknown key');
    return join(this.dir, `${id}.json`);
  }

  private read(id: string): Record {
    const f = this.file(id);
    if (!existsSync(f)) throw new VaultError('unknown key');
    return JSON.parse(readFileSync(f, 'utf8')) as Record;
  }

  private pub(r: Record): PublicInfo {
    const { id, name, title, org, created, fp, publicKey } = r;
    return { id, name, title, org, created, fp, publicKey };
  }

  create(input: { name: unknown; title: unknown; org: unknown; passphrase: unknown }): PublicInfo & { publicPem: string } {
    const name = clean('name', input.name), title = clean('title', input.title), org = clean('institution', input.org);
    const pass = typeof input.passphrase === 'string' ? input.passphrase : '';
    if (pass.length < MIN_PASSPHRASE) throw new VaultError(`passphrase must be at least ${MIN_PASSPHRASE} characters`);
    const { privateKey, publicKey } = generateKeyPair();
    const raw = rawPublic(publicKey), fp = fingerprint(raw);
    mkdirSync(this.dir, { recursive: true });
    const id = randomBytes(8).toString('hex');
    const record: Record = { v: 1, id, name, title, org, created: new Date().toISOString(), fp, publicKey: b64u(raw), sealed: sealPrivateKey(privateKey, fp, pass) };
    writeFileSync(this.file(id), JSON.stringify(record, null, 2), { flag: 'wx', mode: 0o600 });
    return { ...this.pub(record), publicPem: publicKey.export({ format: 'pem', type: 'spki' }).toString() };
  }

  list(): PublicInfo[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir).filter((f) => /^[0-9a-f]{16}\.json$/.test(f))
      .map((f) => this.pub(JSON.parse(readFileSync(join(this.dir, f), 'utf8')) as Record))
      .sort((a, b) => a.created.localeCompare(b.created));
  }

  get(id: string): PublicInfo {
    return this.pub(this.read(id));
  }

  byFingerprint(fp: string): PublicInfo | null {
    return this.list().find((k) => k.fp === fp) ?? null;
  }

  /** Decrypts the private key. A wrong passphrase gives PassphraseError. */
  unlock(id: string, passphrase: string): { info: PublicInfo; privateKey: KeyObject } {
    const r = this.read(id);
    return { info: this.pub(r), privateKey: openPrivateKey(r.sealed, r.fp, passphrase) };
  }
}
