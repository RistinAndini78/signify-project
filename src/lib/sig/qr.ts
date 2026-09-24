import QRCode from 'qrcode';
import { FormatError, b64u, fromB64u } from './encoding';
import { PUB_LEN, SIG_LEN, fingerprint, rawPublic, verifyMessage } from './keys';
import { Meta, qrMessage } from './format';
import type { KeyObject } from 'node:crypto';

export interface QrData { id: string; fp: string; meta: Meta; sig: string }

const TIME_RE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

/** QR text is self-contained JSON so a phone scanner shows signer data instead of a localhost URL. */
export function qrText(d: QrData, _origin: string): string {
  return JSON.stringify({ signerName: d.meta.name, signerRole: d.meta.title, institution: d.meta.org, timestamp: d.meta.time, documentId: d.id, publicKeyFingerprint: d.fp, signature: d.sig }, null, 2);
}

/** Accepts the JSON QR text and legacy links, "#q=..." or bare payloads. */
export function parseQr(text: string): QrData {
  const t = text.trim();
  if (t.startsWith('{')) {
    let o: unknown;
    try { o = JSON.parse(t); } catch { throw new FormatError('bad QR payload'); }
    const v = o as Record<string, unknown>;
    const s = (x: unknown, max: number) => typeof x === 'string' && x.length > 0 && x.length <= max;
    if (!o || typeof o !== 'object' || Array.isArray(o) || JSON.stringify(o, null, 2) !== t
      || !s(v.signerName, 100) || !s(v.signerRole, 100) || !s(v.institution, 100) || !TIME_RE.test(String(v.timestamp))
      || !s(v.documentId, 32) || !/^[0-9a-f]{16}$/.test(String(v.publicKeyFingerprint)) || !s(v.signature, 100)
      || fromB64u(v.signature as string).length !== SIG_LEN) throw new FormatError('bad QR payload');
    return { id: v.documentId as string, fp: v.publicKeyFingerprint as string, meta: { name: v.signerName as string, title: v.signerRole as string, org: v.institution as string, time: v.timestamp as string }, sig: v.signature as string };
  }
  const i = t.lastIndexOf('q=');
  const payload = i >= 0 ? t.slice(i + 2) : t;
  const raw = fromB64u(payload).toString('utf8');
  let a: unknown;
  try { a = JSON.parse(raw); } catch { throw new FormatError('bad QR payload'); }
  const s = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max;
  if (!Array.isArray(a) || a.length !== 8 || a[0] !== 1 || !s(a[1], 32) || !/^[0-9a-f]{16}$/.test(String(a[2])) || !s(a[3], 100) || !s(a[4], 100) || !s(a[5], 100)
    || !TIME_RE.test(String(a[6])) || !s(a[7], 100) || JSON.stringify(a) !== raw || fromB64u(a[7] as string).length !== SIG_LEN) throw new FormatError('bad QR payload');
  return { id: a[1] as string, fp: a[2] as string, meta: { name: a[3] as string, title: a[4] as string, org: a[5] as string, time: a[6] as string }, sig: a[7] as string };
}

export interface QrCheck { ok: boolean; reason: string }

/** The QR signature must verify under the given key, and that key must be the one the QR names. */
export function verifyQr(d: QrData, publicKey: KeyObject): QrCheck {
  const raw = rawPublic(publicKey);
  if (raw.length !== PUB_LEN) return { ok: false, reason: 'bad key' };
  if (fingerprint(raw) !== d.fp) return { ok: false, reason: 'the key does not match the key named in the QR-Code' };
  return verifyMessage(publicKey, qrMessage(d.id, d.fp, d.meta), fromB64u(d.sig))
    ? { ok: true, reason: 'QR-Code signature is valid' }
    : { ok: false, reason: 'QR-Code signature is not valid (its data was changed or forged)' };
}

export async function qrPng(text: string): Promise<{ png: Buffer; modules: number; version: number; bytes: number }> {
  const code = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const png = await QRCode.toBuffer(text, { errorCorrectionLevel: 'M', margin: 2, scale: 6, type: 'png' });
  return { png, modules: code.modules.size, version: code.version, bytes: Buffer.byteLength(text) };
}
