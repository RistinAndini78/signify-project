import { MAX_UPLOAD, allow, clientKey, json, tooLarge } from '../../../lib/http';
import { FormatError } from '../../../lib/sig/encoding';
import { parsePublicKey, publicFromRaw } from '../../../lib/sig/keys';
import { VaultError } from '../../../lib/sig/keystore';
import { verifyDocument } from '../../../lib/sig/service';
import { fromB64u } from '../../../lib/sig/encoding';
import { keystore } from '../../../lib/vault';

export async function POST(req: Request) {
  if (!allow(`verify:${clientKey(req)}`, 60)) return json({ error: 'too many requests' }, 429);
  if (tooLarge(req)) return json({ error: `file exceeds ${MAX_UPLOAD / 1048576} MB` }, 413);
  const form = await req.formData().catch(() => null);
  if (!form) return json({ error: 'multipart form required' }, 400);
  const file = form.get('file'), qr = String(form.get('qr') ?? '').trim(), pubkey = String(form.get('pubkey') ?? '').trim(), keyId = String(form.get('keyId') ?? '').trim();
  if (!(file instanceof File) && !qr) return json({ error: 'a file or a QR payload is required' }, 400);
  if (file instanceof File && !file.name.toLowerCase().endsWith('.pdf')) return json({ error: 'hanya file PDF yang dapat diverifikasi' }, 400);
  if (file instanceof File && file.size > MAX_UPLOAD) return json({ error: `file exceeds ${MAX_UPLOAD / 1048576} MB` }, 413);
  try {
    const store = keystore();
    const registry = (fp: string) => store.byFingerprint(fp)?.name ?? null;
    let publicKey;
    if (pubkey) publicKey = parsePublicKey(pubkey);
    else if (keyId) publicKey = publicFromRaw(fromB64u(store.get(keyId).publicKey));
    const bytes = file instanceof File ? Buffer.from(await file.arrayBuffer()) : Buffer.alloc(0);
    return json(verifyDocument(bytes, { publicKey, qr: qr || undefined, registry }));
  } catch (e) {
    if (e instanceof FormatError || e instanceof VaultError) return json({ error: e.message }, 400);
    throw e;
  }
}
