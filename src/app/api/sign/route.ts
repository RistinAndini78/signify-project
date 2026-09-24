import { MAX_UPLOAD, allow, clientKey, json, tooLarge } from '../../../lib/http';
import { PassphraseError, publicFromRaw } from '../../../lib/sig/keys';
import { VaultError } from '../../../lib/sig/keystore';
import { StampError } from '../../../lib/sig/pdfstamp';
import { SignError, signDocument } from '../../../lib/sig/service';
import { fromB64u } from '../../../lib/sig/encoding';
import { keystore, originOf } from '../../../lib/vault';

const MAX_FILE = 10 * 1024 * 1024; // the signed file travels back as Base64 JSON

export async function POST(req: Request) {
  if (!allow(`sign:${clientKey(req)}`, 20)) return json({ error: 'too many requests' }, 429);
  if (tooLarge(req)) return json({ error: `file exceeds ${MAX_UPLOAD / 1048576} MB` }, 413);
  const form = await req.formData().catch(() => null);
  const keyId = String(form?.get('keyId') ?? ''), passphrase = String(form?.get('passphrase') ?? '');
  const file = form?.get('file');
  if (!(file instanceof File) || !keyId || !passphrase) return json({ error: 'keyId, passphrase, and file are required' }, 400);
  if (!file.name.toLowerCase().endsWith('.pdf')) return json({ error: 'hanya file PDF yang dapat ditandatangani' }, 400);
  if (file.size > MAX_FILE) return json({ error: `file exceeds ${MAX_FILE / 1048576} MB` }, 413);
  // wrong passphrases are limited per client and key
  if (!allow(`unlock:${clientKey(req)}:${keyId}`, 8)) return json({ error: 'too many attempts, try again in a minute' }, 429);
  try {
    const { info, privateKey } = keystore().unlock(keyId, passphrase);
    const publicKey = publicFromRaw(fromB64u(info.publicKey));
    const r = await signDocument(Buffer.from(await file.arrayBuffer()), { privateKey, publicKey, name: info.name, title: info.title, org: info.org }, originOf(req));
    return json({
      file: r.file.toString('base64'), bytes: r.file.length, docId: r.docId, signers: r.signers,
      qr: { png: r.qr.png.toString('base64'), text: r.qr.text, modules: r.qr.modules, version: r.qr.version, bytes: r.qr.bytes },
    });
  } catch (e) {
    if (e instanceof PassphraseError) return json({ error: e.message }, 401);
    if (e instanceof VaultError || e instanceof SignError || e instanceof StampError) return json({ error: e.message }, 400);
    throw e;
  }
}
