import { get, list, put } from '@vercel/blob';
import { KeyObject, randomBytes } from 'node:crypto';
import { b64u } from './sig/encoding';
import { Sealed, PassphraseError, fingerprint, generateKeyPair, openPrivateKey, rawPublic, sealPrivateKey } from './sig/keys';
import { MIN_PASSPHRASE, PublicInfo, VaultError } from './sig/keystore';

interface Record extends PublicInfo { v: 1; sealed: Sealed }

const PREFIX = 'keystore/';
const ID_RE = /^[0-9a-f]{16}$/;
const clean = (label: string, value: unknown, max = 100): string => {
  const text = typeof value === 'string' ? value.trim() : '';
  // eslint-disable-next-line no-control-regex
  if (!text || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) throw new VaultError(`${label} must be 1 to ${max} characters without control characters`);
  return text;
};

export class BlobKeystore {
  private path(id: string) {
    if (!ID_RE.test(id)) throw new VaultError('unknown key');
    return `${PREFIX}${id}.json`;
  }

  private async read(id: string): Promise<Record> {
    try {
      const blob = await get(this.path(id), { access: 'private' });
      if (!blob) throw new VaultError('unknown key');
      return JSON.parse(Buffer.from(await new Response(blob.stream).arrayBuffer()).toString('utf8')) as Record;
    } catch (error) {
      if (error instanceof VaultError) throw error;
      throw new VaultError('unable to read key storage');
    }
  }

  private publicInfo(record: Record): PublicInfo {
    const { id, name, title, org, created, fp, publicKey } = record;
    return { id, name, title, org, created, fp, publicKey };
  }

  async create(input: { name: unknown; title: unknown; org: unknown; passphrase: unknown }): Promise<PublicInfo & { publicPem: string }> {
    const name = clean('name', input.name), title = clean('title', input.title), org = clean('institution', input.org);
    const passphrase = typeof input.passphrase === 'string' ? input.passphrase : '';
    if (passphrase.length < MIN_PASSPHRASE) throw new VaultError(`passphrase must be at least ${MIN_PASSPHRASE} characters`);
    const { privateKey, publicKey } = generateKeyPair();
    const raw = rawPublic(publicKey), fp = fingerprint(raw), id = randomBytes(8).toString('hex');
    const record: Record = { v: 1, id, name, title, org, created: new Date().toISOString(), fp, publicKey: b64u(raw), sealed: sealPrivateKey(privateKey, fp, passphrase) };
    try {
      await put(this.path(id), JSON.stringify(record, null, 2), { access: 'private', addRandomSuffix: false, contentType: 'application/json' });
    } catch {
      throw new VaultError('unable to write key storage; check BLOB_READ_WRITE_TOKEN');
    }
    return { ...this.publicInfo(record), publicPem: publicKey.export({ format: 'pem', type: 'spki' }).toString() };
  }

  async list(): Promise<PublicInfo[]> {
    try {
      const result = await list({ prefix: PREFIX });
      const records = await Promise.all(result.blobs.filter((blob) => /[0-9a-f]{16}\.json$/.test(blob.pathname)).map(async (blob) => {
        const keyId = blob.pathname.slice(PREFIX.length, -'.json'.length);
        return this.publicInfo(await this.read(keyId));
      }));
      return records.sort((a, b) => a.created.localeCompare(b.created));
    } catch {
      throw new VaultError('unable to read key storage; check BLOB_READ_WRITE_TOKEN');
    }
  }

  async get(id: string): Promise<PublicInfo> {
    return this.publicInfo(await this.read(id));
  }

  async byFingerprint(fp: string): Promise<PublicInfo | null> {
    return (await this.list()).find((key) => key.fp === fp) ?? null;
  }

  async unlock(id: string, passphrase: string): Promise<{ info: PublicInfo; privateKey: KeyObject }> {
    const record = await this.read(id);
    try {
      return { info: this.publicInfo(record), privateKey: openPrivateKey(record.sealed, record.fp, passphrase) };
    } catch (error) {
      if (error instanceof PassphraseError) throw error;
      throw new VaultError('unable to unlock key');
    }
  }
}
