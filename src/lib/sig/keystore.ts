import { KeyObject, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { put, list } from '@vercel/blob';
import { b64u } from './encoding';
import { Sealed, fingerprint, generateKeyPair, openPrivateKey, rawPublic, sealPrivateKey } from './keys';

export class VaultError extends Error {}

export interface PublicInfo { id: string; name: string; title: string; org: string; created: string; fp: string; publicKey: string }
interface Record extends PublicInfo { v: 1; sealed: Sealed }

const ID_RE = /^[0-9a-f]{16}$/;
const BLOB_PREFIX = 'keystore';
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

  storageKind(): 'local' | 'blob' {
    return process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : 'local';
  }

  private file(id: string): string {
    if (!ID_RE.test(id)) throw new VaultError('unknown key');
    return join(this.dir, `${id}.json`);
  }

  private readLocal(id: string): Record {
    const f = this.file(id);
    if (!existsSync(f)) throw new VaultError('unknown key');
    return JSON.parse(readFileSync(f, 'utf8')) as Record;
  }

  private pub(r: Record): PublicInfo {
    const { id, name, title, org, created, fp, publicKey } = r;
    return { id, name, title, org, created, fp, publicKey };
  }

  private async readBlob(id: string): Promise<Record> {
    if (!ID_RE.test(id)) throw new VaultError('unknown key');
    try {
      const { blobs } = await list({ prefix: `${BLOB_PREFIX}/${id}.json` });
      const blob = blobs.find((candidate) => candidate.pathname === `${BLOB_PREFIX}/${id}.json`);
      if (!blob) throw new VaultError('unknown key');
      const response = await fetch(blob.url);
      if (!response.ok) throw new VaultError('unknown key');
      return JSON.parse(await response.text()) as Record;
    } catch {
      return this.readLocal(id);
    }
  }

  async create(input: { name: unknown; title: unknown; org: unknown; passphrase: unknown }): Promise<PublicInfo & { publicPem: string }> {
    const name = clean('name', input.name), title = clean('title', input.title), org = clean('institution', input.org);
    const pass = typeof input.passphrase === 'string' ? input.passphrase : '';
    if (pass.length < MIN_PASSPHRASE) throw new VaultError(`passphrase must be at least ${MIN_PASSPHRASE} characters`);
    const { privateKey, publicKey } = generateKeyPair();
    const raw = rawPublic(publicKey), fp = fingerprint(raw);
    const id = randomBytes(8).toString('hex');
    const record: Record = { v: 1, id, name, title, org, created: new Date().toISOString(), fp, publicKey: b64u(raw), sealed: sealPrivateKey(privateKey, fp, pass) };
    const result = { ...this.pub(record), publicPem: publicKey.export({ format: 'pem', type: 'spki' }).toString() };
    if (this.storageKind() === 'blob') {
      try {
        await put(`${BLOB_PREFIX}/${id}.json`, JSON.stringify(record, null, 2), { access: 'private', contentType: 'application/json' });
        return result;
      } catch {
        mkdirSync(this.dir, { recursive: true });
        writeFileSync(this.file(id), JSON.stringify(record, null, 2), { flag: 'wx', mode: 0o600 });
        return result;
      }
    }
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.file(id), JSON.stringify(record, null, 2), { flag: 'wx', mode: 0o600 });
    return result;
  }

  async list(): Promise<PublicInfo[]> {
    if (this.storageKind() === 'blob') {
      try {
        const { blobs } = await list({ prefix: `${BLOB_PREFIX}/` });
        const records = await Promise.all(blobs
          .filter((blob) => /[0-9a-f]{16}\.json$/.test(blob.pathname ?? ''))
          .map(async (blob) => {
            const response = await fetch(blob.url);
            if (!response.ok) return null;
            return JSON.parse(await response.text()) as Record;
          }));
        return records.filter((r): r is Record => !!r).map((r) => this.pub(r)).sort((a, b) => a.created.localeCompare(b.created));
      } catch {
        if (!existsSync(this.dir)) return [];
        return readdirSync(this.dir).filter((f) => /^[0-9a-f]{16}\.json$/.test(f))
          .map((f) => this.pub(JSON.parse(readFileSync(join(this.dir, f), 'utf8')) as Record))
          .sort((a, b) => a.created.localeCompare(b.created));
      }
    }
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir).filter((f) => /^[0-9a-f]{16}\.json$/.test(f))
      .map((f) => this.pub(JSON.parse(readFileSync(join(this.dir, f), 'utf8')) as Record))
      .sort((a, b) => a.created.localeCompare(b.created));
  }

  async get(id: string): Promise<PublicInfo> {
    return this.pub(this.storageKind() === 'blob' ? await this.readBlob(id) : this.readLocal(id));
  }

  async byFingerprint(fp: string): Promise<PublicInfo | null> {
    const keys = await this.list();
    return keys.find((k) => k.fp === fp) ?? null;
  }

  /** Decrypts the private key. A wrong passphrase gives PassphraseError. */
  async unlock(id: string, passphrase: string): Promise<{ info: PublicInfo; privateKey: KeyObject }> {
    const r = this.storageKind() === 'blob' ? await this.readBlob(id) : this.readLocal(id);
    return { info: this.pub(r), privateKey: openPrivateKey(r.sealed, r.fp, passphrase) };
  }
}
