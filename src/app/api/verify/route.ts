import { MAX_UPLOAD, allow, clientKey, json, tooLarge } from '../../../lib/http';
import { FormatError } from '../../../lib/sig/encoding';
import { fingerprint, parsePublicKey, publicFromRaw, rawPublic } from '../../../lib/sig/keys';
import { VaultError } from '../../../lib/sig/keystore';
import { verifyDocument } from '../../../lib/sig/service';
import { fromB64u } from '../../../lib/sig/encoding';
import { keystore } from '../../../lib/vault';

export async function POST(req: Request) {
  if (!allow(`verify:${clientKey(req)}`, 60)) return json({ error: 'too many requests' }, 429);
  if (tooLarge(req)) return json({ error: `file exceeds ${MAX_UPLOAD / 1048576} MB` }, 413);
  const form = await req.formData().catch(() => null);
  if (!form) return json({ error: 'multipart form required' }, 400);
  const file = form.get('file'), qr = String(form.get('qr') ?? '').trim(), pubkey = String(form.get('pubkey') ?? '').trim(), pubkeys = String(form.get('pubkeys') ?? '').trim(), keyId = String(form.get('keyId') ?? '').trim();
  if (!(file instanceof File) && !qr) return json({ error: 'a file or a QR payload is required' }, 400);
  if (file instanceof File && !file.name.toLowerCase().endsWith('.pdf')) return json({ error: 'hanya file PDF yang dapat diverifikasi' }, 400);
  if (file instanceof File && file.size > MAX_UPLOAD) return json({ error: `file exceeds ${MAX_UPLOAD / 1048576} MB` }, 413);
  try {
    const store = keystore();
    const keys = await store.list();
    const registry = (fp: string) => keys.find((key) => key.fp === fp)?.name ?? null;
    const externalKeys = new Map<string, ReturnType<typeof parsePublicKey>>();
    if (pubkeys) {
      let values: unknown;
      try { values = JSON.parse(pubkeys); } catch { return json({ error: 'daftar public key tidak valid' }, 400); }
      if (!Array.isArray(values) || values.length > 12 || values.some((value) => typeof value !== 'string' || value.length > 16 * 1024)) {
        return json({ error: 'daftar public key harus berisi maksimal 12 file PEM yang valid' }, 400);
      }
      for (const value of values as string[]) {
        const externalKey = parsePublicKey(value);
        externalKeys.set(fingerprint(rawPublic(externalKey)), externalKey);
      }
    }
    let publicKey;
    if (pubkey) publicKey = parsePublicKey(pubkey);
    else if (keyId) publicKey = publicFromRaw(fromB64u((await store.get(keyId)).publicKey));
    const bytes = file instanceof File ? Buffer.from(await file.arrayBuffer()) : Buffer.alloc(0);
    const report = verifyDocument(bytes, { publicKey, publicKeys: externalKeys.size > 0 ? externalKeys : undefined, qr: qr || undefined, registry });
    const signerFingerprints = new Set(report.signers.map((signer) => signer.fp));
    const unmatchedPublicKeys = [...externalKeys.keys()].filter((fp) => !signerFingerprints.has(fp));
    return json({ ...report, unmatchedPublicKeys });
  } catch (e) {
    if (e instanceof FormatError || e instanceof VaultError) return json({ error: e.message }, 400);
    throw e;
  }
}
