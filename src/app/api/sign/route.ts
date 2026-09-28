import { MAX_UPLOAD, allow, clientKey, json, tooLarge } from '../../../lib/http';
import { PassphraseError, publicFromRaw } from '../../../lib/sig/keys';
import { cleanIdentity, unlockPortableKey, VaultError } from '../../../lib/sig/keystore';
import { StampError } from '../../../lib/sig/pdfstamp';
import { SignError, signDocument, signDocumentChain } from '../../../lib/sig/service';
import { fromB64u } from '../../../lib/sig/encoding';
import { keystore, originOf } from '../../../lib/vault';

const MAX_FILE = 10 * 1024 * 1024; // the signed file travels back as Base64 JSON

export async function POST(req: Request) {
  if (!allow(`sign:${clientKey(req)}`, 40)) return json({ error: 'too many requests' }, 429);
  if (tooLarge(req)) return json({ error: `file exceeds ${MAX_UPLOAD / 1048576} MB` }, 413);
  const form = await req.formData().catch(() => null);
  if (!form) return json({ error: 'form data tidak valid' }, 400);
  const keyId = String(form?.get('keyId') ?? ''), passphrase = String(form?.get('passphrase') ?? '');
  const file = form?.get('file'), dsk = form?.get('dsk');
  if (!(file instanceof File)) return json({ error: 'PDF wajib diisi' }, 400);
  if (!file.name.toLowerCase().endsWith('.pdf')) return json({ error: 'hanya file PDF yang dapat ditandatangani' }, 400);
  if (file.size > MAX_FILE) return json({ error: `file exceeds ${MAX_FILE / 1048576} MB` }, 413);
  const signerJson = form?.get('signers');
  if (signerJson !== null && signerJson !== undefined) {
    if (typeof signerJson !== 'string') return json({ error: 'daftar signer tidak valid' }, 400);
    let descriptors: unknown;
    try { descriptors = JSON.parse(signerJson); } catch { return json({ error: 'format daftar signer tidak valid' }, 400); }
    if (!Array.isArray(descriptors) || descriptors.length < 2 || descriptors.length > 12) return json({ error: 'multi-signature memerlukan 2 sampai 12 signer' }, 400);
    try {
      const signers = [];
      for (let index = 0; index < descriptors.length; index += 1) {
        const descriptor = descriptors[index] as { name?: unknown; title?: unknown; org?: unknown } | null;
        if (!descriptor || typeof descriptor !== 'object') return json({ error: `data signer ${index + 1} tidak valid` }, 400);
        const signerFile = form.get(`dsk-${index}`), signerPassphrase = form.get(`passphrase-${index}`);
        if (!(signerFile instanceof File) || !signerPassphrase || typeof signerPassphrase !== 'string') return json({ error: `file .dsk dan passphrase signer ${index + 1} wajib diisi` }, 400);
        if (!signerFile.name.toLowerCase().endsWith('.dsk') || signerFile.size > 64 * 1024) return json({ error: `file .dsk signer ${index + 1} tidak valid` }, 400);
        let portable: unknown;
        try { portable = JSON.parse(await signerFile.text()); } catch { return json({ error: `isi file .dsk signer ${index + 1} tidak valid` }, 400); }
        const portableFp = portable && typeof portable === 'object' ? (portable as { fp?: unknown }).fp : null;
        if (typeof portableFp === 'string' && !allow(`unlock:${clientKey(req)}:${portableFp}`, 40)) return json({ error: 'terlalu banyak percobaan passphrase; coba lagi dalam satu menit' }, 429);
        const identity = cleanIdentity({ name: descriptor.name, title: descriptor.title, org: descriptor.org });
        signers.push({ ...unlockPortableKey(portable, signerPassphrase), ...identity });
      }
      const result = await signDocumentChain(Buffer.from(await file.arrayBuffer()), signers, originOf(req));
      return json({
        file: result.file.toString('base64'), bytes: result.file.length, docId: result.docId, signers: result.signers,
        qr: {
          png: result.qr.png.toString('base64'), text: result.qr.text, modules: result.qr.modules, version: result.qr.version, bytes: result.qr.bytes,
          secondary: result.qr.secondary ? { ...result.qr.secondary, png: result.qr.secondary.png.toString('base64') } : undefined,
          codes: result.qr.codes?.map((code) => ({ ...code, png: code.png.toString('base64') })),
        },
      });
    } catch (error) {
      if (error instanceof PassphraseError) return json({ error: 'passphrase salah atau salah satu file .dsk rusak' }, 401);
      if (error instanceof VaultError || error instanceof SignError || error instanceof StampError) return json({ error: error.message }, 400);
      throw error;
    }
  }
  if (!passphrase || (!(dsk instanceof File) && !keyId)) return json({ error: 'file .dsk atau kunci terdaftar dan passphrase wajib diisi' }, 400);
  if (dsk instanceof File) {
    if (!dsk.name.toLowerCase().endsWith('.dsk')) return json({ error: 'file kunci harus berformat .dsk' }, 400);
    if (dsk.size > 64 * 1024) return json({ error: 'file .dsk terlalu besar atau tidak valid' }, 413);
    let portable: unknown;
    try { portable = JSON.parse(await dsk.text()); } catch { return json({ error: 'isi file .dsk bukan format yang valid' }, 400); }
    const portableFp = portable && typeof portable === 'object' ? (portable as { fp?: unknown }).fp : null;
    if (typeof portableFp === 'string' && !allow(`unlock:${clientKey(req)}:${portableFp}`, 40)) {
      return json({ error: 'Terlalu banyak percobaan passphrase. Coba lagi dalam satu menit.' }, 429);
    }
    try {
      const identity = cleanIdentity({ name: form?.get('name'), title: form?.get('title'), org: form?.get('org') });
      const unlocked = unlockPortableKey(portable, passphrase);
      const r = await signDocument(Buffer.from(await file.arrayBuffer()), { ...unlocked, ...identity }, originOf(req));
      return json({
        file: r.file.toString('base64'), bytes: r.file.length, docId: r.docId, signers: r.signers,
        qr: { png: r.qr.png.toString('base64'), text: r.qr.text, modules: r.qr.modules, version: r.qr.version, bytes: r.qr.bytes, secondary: r.qr.secondary ? { ...r.qr.secondary, png: r.qr.secondary.png.toString('base64') } : undefined },
      });
    } catch (e) {
      if (e instanceof PassphraseError) return json({ error: 'Passphrase salah atau file .dsk rusak' }, 401);
      if (e instanceof VaultError || e instanceof SignError || e instanceof StampError) return json({ error: e.message }, 400);
      throw e;
    }
  }
  // wrong passphrases are limited per client and key
  if (!allow(`unlock:${clientKey(req)}:${keyId}`, 40)) return json({ error: 'too many attempts, try again in a minute' }, 429);
  try {
    const firstKeyId = String(form?.get('firstKeyId') ?? '');
    const firstPassphrase = String(form?.get('firstPassphrase') ?? '');
    if (firstKeyId || firstPassphrase) {
      if (!firstKeyId || !firstPassphrase || firstKeyId === keyId) return json({ error: 'dua signer berbeda dan password keduanya diperlukan' }, 400);
      const first = await keystore().unlock(firstKeyId, firstPassphrase);
      const firstPublicKey = publicFromRaw(fromB64u(first.info.publicKey));
      const current = await keystore().unlock(keyId, passphrase);
      const currentPublicKey = publicFromRaw(fromB64u(current.info.publicKey));
      const r = await signDocumentChain(Buffer.from(await file.arrayBuffer()), [
        { privateKey: first.privateKey, publicKey: firstPublicKey, name: first.info.name, title: first.info.title, org: first.info.org },
        { privateKey: current.privateKey, publicKey: currentPublicKey, name: current.info.name, title: current.info.title, org: current.info.org },
      ], originOf(req));
      return json({
        file: r.file.toString('base64'), bytes: r.file.length, docId: r.docId, signers: r.signers,
        qr: { png: r.qr.png.toString('base64'), text: r.qr.text, modules: r.qr.modules, version: r.qr.version, bytes: r.qr.bytes, secondary: r.qr.secondary ? { ...r.qr.secondary, png: r.qr.secondary.png.toString('base64') } : undefined },
      });
    }
    const { info, privateKey } = await keystore().unlock(keyId, passphrase);
    const publicKey = publicFromRaw(fromB64u(info.publicKey));
    const r = await signDocument(Buffer.from(await file.arrayBuffer()), { privateKey, publicKey, name: info.name, title: info.title, org: info.org }, originOf(req));
    return json({
      file: r.file.toString('base64'), bytes: r.file.length, docId: r.docId, signers: r.signers,
      qr: {
        png: r.qr.png.toString('base64'), text: r.qr.text, modules: r.qr.modules, version: r.qr.version, bytes: r.qr.bytes,
        secondary: r.qr.secondary ? { ...r.qr.secondary, png: r.qr.secondary.png.toString('base64') } : undefined,
      },
    });
  } catch (e) {
    if (e instanceof PassphraseError) return json({ error: e.message }, 401);
    if (e instanceof VaultError || e instanceof SignError || e instanceof StampError) return json({ error: e.message }, 400);
    throw e;
  }
}
