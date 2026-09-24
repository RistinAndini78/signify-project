// Signing and verification of a document. Keys come from the caller; nothing here touches disk.
import { KeyObject, randomBytes } from 'node:crypto';
import { b64u, fromB64u, sha256hex } from './encoding';
import { Block, Located, Meta, docMessage, encodeBlock, metaOf, parseBlocks, qrMessage } from './format';
import { fingerprint, publicFromRaw, rawPublic, signMessage, verifyMessage } from './keys';
import { QrData, parseQr, qrPng, qrText, verifyQr } from './qr';
import { addQrPage, isPdf } from './pdfstamp';

export class SignError extends Error {}

export interface Signer { privateKey: KeyObject; publicKey: KeyObject; name: string; title: string; org: string }

export interface SignResult { file: Buffer; docId: string; block: Block; signers: number; qr: { png: Buffer; text: string; modules: number; version: number; bytes: number } }

export interface SignerReport {
  index: number; name: string; title: string; org: string; time: string; fp: string; docId: string;
  hashOk: boolean; sigOk: boolean; qrOk: boolean; keyMatches: boolean; valid: boolean; registeredAs: string | null; reason: string;
}

export interface VerifyReport {
  valid: boolean; blocks: number; signers: SignerReport[];
  qr: (QrData & { ok: boolean; reason: string; registeredAs: string | null }) | { ok: false; reason: string } | null;
  message: string;
}

export interface VerifyOptions {
  /** Use this key instead of the key stored in each block (the "wrong key" test, or a key obtained elsewhere). */
  publicKey?: KeyObject;
  /** QR text or payload to check. */
  qr?: string;
  /** Name of a registered key, by fingerprint, or null. */
  registry?: (fp: string) => string | null;
}

/** Signs `file`. A file without blocks gets the first signature (and a QR page if it is a PDF); a signed file gets a further signature. */
export async function signDocument(file: Buffer, signer: Signer, origin: string, now: Date = new Date()): Promise<SignResult> {
  const pubRaw = rawPublic(signer.publicKey), fp = fingerprint(pubRaw);
  const existing = parseBlocks(file);
  let body = file, docId: string;
  if (existing.length === 0) {
    docId = b64u(randomBytes(12));
  } else {
    const check = verifyDocument(file);
    if (!check.valid) throw new SignError('the document already has a signature that is not valid; it was changed, so it cannot be signed further');
    if (existing.some((e) => fingerprint(fromB64u(e.block.pk)) === fp)) throw new SignError('this key has already signed the document');
    docId = existing[existing.length - 1].block.id;
  }
  const meta: Meta = { name: signer.name, title: signer.title, org: signer.org, time: now.toISOString() };
  const qs = signMessage(signer.privateKey, qrMessage(docId, fp, meta));
  const q = await qrPng(qrText({ id: docId, fp, meta, sig: b64u(qs) }, origin));
  if (existing.length === 0 && isPdf(file)) {
    body = await addQrPage(file, {
      qrPng: q.png, title: 'Halaman Pengesahan Tanda Tangan Digital', url: qrText({ id: docId, fp, meta, sig: b64u(qs) }, origin),
      lines: [`Ditandatangani oleh: ${meta.name}`, `Jabatan: ${meta.title}`, `Institusi: ${meta.org}`, `Waktu: ${meta.time}`, `ID dokumen: ${docId}`, `Sidik jari kunci publik: ${fp}`, 'Algoritma: ECDSA P-256 dengan SHA-256'],
    });
  }
  const h = sha256hex(body);
  const sig = signMessage(signer.privateKey, docMessage(h, docId, fp, meta, b64u(qs)));
  const block: Block = { v: 1, id: docId, alg: 'ES256', h, n: meta.name, t: meta.title, o: meta.org, d: meta.time, pk: b64u(pubRaw), sig: b64u(sig), qs: b64u(qs) };
  return { file: Buffer.concat([body, encodeBlock(block)]), docId, block, signers: existing.length + 1, qr: { png: q.png, text: qrText({ id: docId, fp, meta, sig: b64u(qs) }, origin), modules: q.modules, version: q.version, bytes: q.bytes } };
}

function verifyBlock(file: Buffer, loc: Located, index: number, opts: VerifyOptions): SignerReport {
  const b = loc.block, meta = metaOf(b), claimedRaw = fromB64u(b.pk);
  const key = opts.publicKey ?? publicFromRaw(claimedRaw);
  const fp = fingerprint(rawPublic(key));
  const keyMatches = fp === fingerprint(claimedRaw);
  const hashOk = sha256hex(file.subarray(0, loc.start)) === b.h;
  const sigOk = keyMatches && verifyMessage(key, docMessage(b.h, b.id, fp, meta, b.qs), fromB64u(b.sig));
  const qrOk = keyMatches && verifyMessage(key, qrMessage(b.id, fp, meta), fromB64u(b.qs));
  const reason = !hashOk ? 'the document was changed after this signature' : !keyMatches ? 'the public key does not match the signer key' : !sigOk ? 'the signature is not valid' : !qrOk ? 'the QR signature in the block is not valid' : 'valid';
  return { index: index + 1, name: b.n, title: b.t, org: b.o, time: b.d, fp: fingerprint(claimedRaw), docId: b.id, hashOk, sigOk, qrOk, keyMatches, valid: hashOk && sigOk && qrOk, registeredAs: opts.registry?.(fingerprint(claimedRaw)) ?? null, reason };
}

export function verifyDocument(file: Buffer, opts: VerifyOptions = {}): VerifyReport {
  const located = parseBlocks(file);
  const signers = located.map((l, i) => {
    try {
      return verifyBlock(file, l, i, opts);
    } catch {
      // for example a public key that is not a point on the curve
      const b = l.block;
      return { index: i + 1, name: b.n, title: b.t, org: b.o, time: b.d, fp: '', docId: b.id, hashOk: false, sigOk: false, qrOk: false, keyMatches: false, valid: false, registeredAs: null, reason: 'the public key in the signature block is not valid' } as SignerReport;
    }
  });
  let qr: VerifyReport['qr'] = null;
  if (opts.qr) {
    try {
      const d = parseQr(opts.qr);
      const key = opts.publicKey ?? (() => {
        const fromFile = located.find((l) => fingerprint(fromB64u(l.block.pk)) === d.fp);
        try { return fromFile ? publicFromRaw(fromB64u(fromFile.block.pk)) : null; } catch { return null; }
      })();
      const c = key ? verifyQr(d, key) : { ok: false, reason: 'no public key to check the QR-Code (upload the signed document or choose a key)' };
      // a QR-Code only vouches for its signer and document id; it must belong to the file that is being checked
      const other = file.length > 0 && !located.some((l) => l.block.id === d.id);
      qr = { ...d, ok: c.ok && !other, reason: c.ok && other ? 'the QR-Code is valid but belongs to another document (document id does not match this file)' : c.reason, registeredAs: opts.registry?.(d.fp) ?? null };
    } catch {
      qr = { ok: false, reason: 'the QR payload is not valid' };
    }
  }
  const valid = signers.length > 0 && signers.every((s) => s.valid);
  const message = signers.length === 0
    ? 'No valid signature block at the end of the file: it was never signed, or it was changed after signing.'
    : valid ? `All ${signers.length} signature(s) are valid and the document is unchanged.` : 'At least one signature is not valid.';
  return { valid, blocks: signers.length, signers, qr, message };
}
