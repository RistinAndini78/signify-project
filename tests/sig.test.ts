import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { afterAll, describe, expect, it } from 'vitest';
import { b64u, fromB64u } from '../src/lib/sig/encoding';
import { encodeBlock, parseBlocks } from '../src/lib/sig/format';
import { PassphraseError, generateKeyPair, openPrivateKey, parsePublicKey, rawPublic, sealPrivateKey, signMessage, verifyMessage } from '../src/lib/sig/keys';
import { createPortableKey, Keystore, unlockPortableKey, VaultError } from '../src/lib/sig/keystore';
import { isPdf } from '../src/lib/sig/pdfstamp';
import { parseQr, qrText } from '../src/lib/sig/qr';
import { Signer, SignError, signDocument, signDocumentChain, verifyDocument } from '../src/lib/sig/service';
import { POST as exportKey } from '../src/app/api/keys/export/route';
import { POST as signRequest } from '../src/app/api/sign/route';
import { POST as verifyRequest } from '../src/app/api/verify/route';

const ORIGIN = 'http://localhost:3000';
const dir = mkdtempSync(join(tmpdir(), 'kripto-vault-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const mk = (name: string, title = 'Dekan', org = 'Fakultas Teknik UNSIL'): Signer => ({ ...generateKeyPair(), name, title, org });
const alice = mk('Alice Rahma'), bob = mk('Bob Santoso', 'Kaprodi'), carol = mk('Carol Dewi', 'Sekretaris');

async function pdf(pages = 2): Promise<Buffer> {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage([300, 300]).drawText(`Halaman ${i + 1}: surat keterangan`, { x: 20, y: 250 });
  return Buffer.from(await d.save({ useObjectStreams: false }));
}

describe('keys', () => {
  it('signs and verifies, and rejects a changed message, a wrong key, and a bad signature length', () => {
    const k = generateKeyPair(), other = generateKeyPair();
    const sig = signMessage(k.privateKey, 'pesan');
    expect(sig.length).toBe(64);
    expect(verifyMessage(k.publicKey, 'pesan', sig)).toBe(true);
    expect(verifyMessage(k.publicKey, 'pesan!', sig)).toBe(false);
    expect(verifyMessage(other.publicKey, 'pesan', sig)).toBe(false);
    expect(verifyMessage(k.publicKey, 'pesan', sig.subarray(0, 63))).toBe(false);
  });

  it('seals the private key: right passphrase opens it, wrong passphrase or changed fingerprint does not', () => {
    const k = generateKeyPair();
    const s = sealPrivateKey(k.privateKey, 'abcd1234abcd1234', 'kata sandi panjang');
    const back = openPrivateKey(s, 'abcd1234abcd1234', 'kata sandi panjang');
    expect(verifyMessage(k.publicKey, 'x', signMessage(back, 'x'))).toBe(true);
    expect(() => openPrivateKey(s, 'abcd1234abcd1234', 'salah')).toThrow(PassphraseError);
    expect(() => openPrivateKey(s, 'ffffffffffffffff', 'kata sandi panjang')).toThrow(PassphraseError);
    expect(JSON.stringify(s)).not.toContain('PRIVATE');
  });

  it('exports a portable encrypted key that can be unlocked without storing it', () => {
    const generated = createPortableKey('passphrase-kuat');
    const unlocked = unlockPortableKey(generated.key, 'passphrase-kuat');
    const signature = signMessage(unlocked.privateKey, 'uji portable');
    expect(verifyMessage(unlocked.publicKey, 'uji portable', signature)).toBe(true);
    expect(generated.key.fp).toBe(unlocked.fp);
    expect(generated.key).not.toHaveProperty('name');
    expect(JSON.stringify(generated.key)).not.toContain('PRIVATE KEY');
    expect(generated.publicPem).toContain('BEGIN PUBLIC KEY');
    expect(() => createPortableKey('1234567')).toThrow(VaultError);
    expect(() => unlockPortableKey(generated.key, 'passphrase-salah')).toThrow(PassphraseError);
    expect(() => unlockPortableKey({ ...generated.key, fp: 'ffffffffffffffff' }, 'passphrase-kuat')).toThrow(VaultError);
  });

  it('rejects a point that is not on the curve and accepts PEM and raw public keys', () => {
    const k = generateKeyPair(), raw = rawPublic(k.publicKey);
    expect(rawPublic(parsePublicKey(b64u(raw))).equals(raw)).toBe(true);
    expect(rawPublic(parsePublicKey(k.publicKey.export({ format: 'pem', type: 'spki' }).toString())).equals(raw)).toBe(true);
    const bad = Buffer.from(raw); bad[10] ^= 1;
    expect(() => parsePublicKey(b64u(bad))).toThrow();
  });
});

describe('keystore', () => {
  const store = new Keystore(dir);
  it('creates keys, lists only public data, unlocks with the passphrase, and refuses weak input', async () => {
    const info = await store.create({ name: 'Dewi', title: 'Dosen', org: 'UNSIL', passphrase: 'kata-sandi-panjang' });
    const all = await store.list();
    expect(all.map((k) => k.id)).toContain(info.id);
    expect(JSON.stringify(all)).not.toMatch(/sealed|ct|PRIVATE/);
    expect((await store.unlock(info.id, 'kata-sandi-panjang')).info.fp).toBe(info.fp);
    await expect(store.unlock(info.id, 'salah-salah-salah')).rejects.toThrow(PassphraseError);
    await expect(store.create({ name: 'A', title: 'B', org: 'C', passphrase: 'pendek' })).rejects.toThrow(VaultError);
    await expect(store.create({ name: '', title: 'B', org: 'C', passphrase: 'kata-sandi-panjang' })).rejects.toThrow(VaultError);
    await expect(store.unlock('../../etc/passwd', 'x')).rejects.toThrow(VaultError);
    expect((await store.byFingerprint(info.fp))?.name).toBe('Dewi');
  });
});

describe('sign and verify a PDF', () => {
  it('creates a downloadable .dsk and signs a PDF through the upload API without a stored key id', async () => {
    const keyResponse = await exportKey(new Request('http://localhost/api/keys/export', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passphrase: 'passphrase-uji' }),
    }));
    expect(keyResponse.status).toBe(201);
    const key = await keyResponse.json() as { keyFile: string; fp: string; publicPem: string };
    const form = new FormData();
    form.set('dsk', new File([key.keyFile], 'signify-test.dsk', { type: 'application/json' }));
    form.set('passphrase', 'passphrase-uji');
    form.set('name', 'Penguji'); form.set('title', 'Dosen'); form.set('org', 'Universitas');
    form.set('file', new File([Uint8Array.from(await pdf(1))], 'surat.pdf', { type: 'application/pdf' }));
    const signResponse = await signRequest(new Request('http://localhost/api/sign', { method: 'POST', body: form }));
    expect(signResponse.status).toBe(200);
    const result = await signResponse.json() as { file: string };
    const report = verifyDocument(Buffer.from(result.file, 'base64'));
    expect(report.valid).toBe(true);
    expect(report.signers[0]).toMatchObject({ name: 'Penguji', title: 'Dosen', org: 'Universitas', fp: key.fp });
    expect(key.publicPem).toContain('BEGIN PUBLIC KEY');

    const nextKeyResponse = await exportKey(new Request('http://localhost/api/keys/export', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passphrase: 'passphrase-signer-kedua' }),
    }));
    const nextKey = await nextKeyResponse.json() as { keyFile: string };
    const nextForm = new FormData();
    nextForm.set('dsk', new File([nextKey.keyFile], 'signer-kedua.dsk', { type: 'application/json' }));
    nextForm.set('passphrase', 'passphrase-signer-kedua');
    nextForm.set('name', 'Signer Kedua'); nextForm.set('title', 'Ketua'); nextForm.set('org', 'Fakultas');
    nextForm.set('file', new File([Uint8Array.from(Buffer.from(result.file, 'base64'))], 'multi-sign-1.signed.pdf', { type: 'application/pdf' }));
    const nextResponse = await signRequest(new Request('http://localhost/api/sign', { method: 'POST', body: nextForm }));
    expect(nextResponse.status).toBe(200);
    const nextResult = await nextResponse.json() as { file: string; signers: number };
    const chainReport = verifyDocument(Buffer.from(nextResult.file, 'base64'));
    expect(nextResult.signers).toBe(2);
    expect(chainReport.valid).toBe(true);
    expect(chainReport.signers.map((signer) => signer.name)).toEqual(['Penguji', 'Signer Kedua']);
  });

  it('verifies an uploaded signed PDF and external public PEM, and rejects a different public key', async () => {
    const signed = await signDocument(await pdf(1), alice, ORIGIN);
    expect(parseQr(signed.qr.text).id).toBe(signed.docId);
    const publicPem = alice.publicKey.export({ format: 'pem', type: 'spki' }).toString();
    const form = new FormData();
    form.set('file', new File([Uint8Array.from(signed.file)], 'signed.pdf', { type: 'application/pdf' }));
    form.set('pubkey', publicPem);
    form.set('qr', signed.qr.text);
    const roundTrip = await new Request('http://localhost/api/verify', { method: 'POST', body: form }).formData();
    expect(parseQr(String(roundTrip.get('qr'))).id).toBe(signed.docId);
    const response = await verifyRequest(new Request('http://localhost/api/verify', { method: 'POST', body: form }));
    expect(response.status).toBe(200);
    const report = await response.json() as { valid: boolean; signers: { keyMatches: boolean }[]; qr: { ok: boolean } };
    expect(report).toMatchObject({ valid: true, signers: [{ keyMatches: true }] });
    expect(report.qr, JSON.stringify(report.qr)).toMatchObject({ ok: true });

    form.set('pubkey', bob.publicKey.export({ format: 'pem', type: 'spki' }).toString());
    const wrongKeyResponse = await verifyRequest(new Request('http://localhost/api/verify', { method: 'POST', body: form }));
    const wrongKeyReport = await wrongKeyResponse.json() as { valid: boolean; signers: { keyMatches: boolean }[]; qr: { ok: boolean } };
    expect(wrongKeyReport).toMatchObject({ valid: false, signers: [{ keyMatches: false }], qr: { ok: false } });
  });

  it('adds a QR page, verifies, and reports the signer', async () => {
    const src = await pdf(2);
    const r = await signDocument(src, alice, ORIGIN);
    expect(isPdf(r.file)).toBe(true);
    const doc = await PDFDocument.load(r.file);
    expect(doc.getPageCount()).toBe(3);
    const v = verifyDocument(r.file, { qr: r.qr.text, registry: () => 'terdaftar' });
    expect(v.valid).toBe(true);
    expect(v.signers[0]).toMatchObject({ name: 'Alice Rahma', title: 'Dekan', hashOk: true, sigOk: true, registeredAs: 'terdaftar' });
    expect(v.qr).toMatchObject({ ok: true });
  });

  it('rejects a document that is not signed at all', async () => {
    expect(verifyDocument(await pdf(1)).valid).toBe(false);
    expect(verifyDocument(Buffer.from('bukan dokumen')).blocks).toBe(0);
  });

  it('changing one byte of the PDF is detected (many positions across the file)', async () => {
    const r = await signDocument(await pdf(3), alice, ORIGIN);
    const n = parseBlocks(r.file)[0].start;
    for (let i = 0; i < 300; i++) {
      const pos = Math.floor((i * n) / 300);
      const t = Buffer.from(r.file); t[pos] ^= 0x01;
      const v = verifyDocument(t);
      expect(v.valid, `byte ${pos}`).toBe(false);
    }
  });
});

describe('every byte of a small signed file', () => {
  it('any single flipped byte, in the document or in the signature block, makes the result invalid', async () => {
    const r = await signDocument(Buffer.from('Surat keterangan nomor 001 - isi singkat.\n'), alice, ORIGIN);
    expect(verifyDocument(r.file).valid).toBe(true);
    for (let i = 0; i < r.file.length; i++) {
      const t = Buffer.from(r.file); t[i] ^= 0x01;
      expect(verifyDocument(t).valid, `byte ${i}`).toBe(false);
    }
  }, 60_000);

  it('appended or removed bytes are detected', async () => {
    const r = await signDocument(Buffer.from('isi surat'), alice, ORIGIN);
    expect(verifyDocument(Buffer.concat([r.file, Buffer.from(' ')])).valid).toBe(false);
    expect(verifyDocument(r.file.subarray(0, r.file.length - 1)).valid).toBe(false);
    expect(verifyDocument(Buffer.concat([Buffer.from('X'), r.file])).valid).toBe(false);
  });
});

describe('wrong key and forged data', () => {
  it('a different public key does not verify the signature', async () => {
    const r = await signDocument(await pdf(1), alice, ORIGIN);
    const v = verifyDocument(r.file, { publicKey: bob.publicKey });
    expect(v.valid).toBe(false);
    expect(v.signers[0].keyMatches).toBe(false);
    expect(verifyDocument(r.file, { publicKey: alice.publicKey }).valid).toBe(true);
  });

  it('a signature block copied from another document does not verify', async () => {
    const a = await signDocument(Buffer.from('dokumen A'), alice, ORIGIN);
    const b = await signDocument(Buffer.from('dokumen B'), alice, ORIGIN);
    const forged = Buffer.concat([Buffer.from('dokumen B'), encodeBlock(parseBlocks(a.file)[0].block)]);
    expect(verifyDocument(forged).valid).toBe(false);
    expect(verifyDocument(b.file).valid).toBe(true);
  });

  it('an attacker signing with a different key is not the registered signer', async () => {
    const forgery = await signDocument(Buffer.from('surat palsu'), mk('Alice Rahma'), ORIGIN);
    const v = verifyDocument(forgery.file, { registry: (fp) => (fp === 'cocok' ? 'Alice Rahma' : null) });
    expect(v.valid).toBe(true); // a valid signature by an unknown key...
    expect(v.signers[0].registeredAs).toBeNull(); // ...that is not a registered key
  });

  it('a forged QR-Code is rejected: every field changed, another signer, and another key', async () => {
    const r = await signDocument(await pdf(1), alice, ORIGIN);
    const q = parseQr(r.qr.text);
    const variants = {
      name: { ...q, meta: { ...q.meta, name: 'Mallory' } }, title: { ...q, meta: { ...q.meta, title: 'Rektor' } },
      org: { ...q, meta: { ...q.meta, org: 'Lain' } }, time: { ...q, meta: { ...q.meta, time: '2030-01-01T00:00:00.000Z' } },
      id: { ...q, id: b64u(Buffer.alloc(12, 7)) },
    };
    for (const [k, d] of Object.entries(variants)) {
      const v = verifyDocument(r.file, { qr: qrText(d, ORIGIN) });
      expect(v.qr && 'ok' in v.qr && v.qr.ok, k).toBe(false);
    }
    const otherKey = await signDocument(await pdf(1), bob, ORIGIN);
    const swapped = verifyDocument(r.file, { qr: otherKey.qr.text });
    expect(swapped.qr && 'ok' in swapped.qr && swapped.qr.ok).toBe(false);
    expect(verifyDocument(r.file, { qr: r.qr.text, publicKey: bob.publicKey }).qr).toMatchObject({ ok: false });
    expect(verifyDocument(r.file, { qr: 'ini bukan qr' }).qr).toMatchObject({ ok: false });
  });

  it('a valid QR-Code of another document is refused for this file', async () => {
    const a = await signDocument(await pdf(1), alice, ORIGIN);
    const b = await signDocument(await pdf(2), alice, ORIGIN);
    expect(verifyDocument(b.file, { qr: b.qr.text }).qr).toMatchObject({ ok: true });
    expect(verifyDocument(b.file, { qr: a.qr.text }).qr).toMatchObject({ ok: false });
    expect(verifyDocument(Buffer.alloc(0), { qr: a.qr.text, publicKey: alice.publicKey }).qr).toMatchObject({ ok: true }); // QR-only check with a known key
  });

  it('the QR-Code image decodes to the link and the payload', async () => {
    const r = await signDocument(await pdf(1), alice, ORIGIN);
    const png = PNG.sync.read(r.qr.png);
    const got = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    expect(got?.data).toBe(r.qr.text);
    expect(parseQr(got!.data).meta.name).toBe('Alice Rahma');
    expect(r.qr.bytes).toBeLessThan(500);
  });
});

describe('several signers', () => {
  it('builds the final PDF with two QR codes before creating both valid signature blocks', async () => {
    const result = await signDocumentChain(await pdf(1), [alice, bob], ORIGIN);
    const report = verifyDocument(result.file);
    expect(report.valid).toBe(true);
    expect(report.signers.map((signer) => signer.name)).toEqual(['Alice Rahma', 'Bob Santoso']);
    expect(result.qr.secondary?.signer.name).toBe('Alice Rahma');
    expect((await PDFDocument.load(result.file)).getPageCount()).toBe(2);
  });

  it('three signers sign in turn; all are valid, share one document id, and the QR page is added once', async () => {
    const one = await signDocument(await pdf(2), alice, ORIGIN);
    const two = await signDocument(one.file, bob, ORIGIN);
    const three = await signDocument(two.file, carol, ORIGIN);
    const v = verifyDocument(three.file);
    expect(v.valid).toBe(true);
    expect(v.signers.map((s) => s.name)).toEqual(['Alice Rahma', 'Bob Santoso', 'Carol Dewi']);
    expect(new Set(v.signers.map((s) => s.docId)).size).toBe(1);
    expect((await PDFDocument.load(three.file)).getPageCount()).toBe(3);
  });

  it('keeps the previous signer QR in the multi-sign result so the final page can show both QR codes', async () => {
    const one = await signDocument(await pdf(1), alice, ORIGIN);
    const two = await signDocument(one.file, bob, ORIGIN);
    expect(two.qr.secondary).toMatchObject({
      signer: { name: 'Alice Rahma', title: 'Dekan', org: 'Fakultas Teknik UNSIL' },
      ok: true,
    });
  });

  it('changing the document breaks every signature; removing the last signer leaves the earlier ones valid', async () => {
    const one = await signDocument(await pdf(1), alice, ORIGIN);
    const two = await signDocument(one.file, bob, ORIGIN);
    const t = Buffer.from(two.file); t[100] ^= 1;
    expect(verifyDocument(t).signers.every((s) => !s.valid)).toBe(true);
    const cut = two.file.subarray(0, parseBlocks(two.file)[1].start);
    const v = verifyDocument(cut);
    expect(v.valid).toBe(true);
    expect(v.blocks).toBe(1);
  });

  it('the same key cannot sign twice, and a damaged document cannot be signed further', async () => {
    const one = await signDocument(Buffer.from('surat'), alice, ORIGIN);
    await expect(signDocument(one.file, alice, ORIGIN)).rejects.toThrow(SignError);
    const t = Buffer.from(one.file); t[2] ^= 1;
    await expect(signDocument(t, bob, ORIGIN)).rejects.toThrow(SignError); // a changed document cannot be signed further
  });
});

describe('storage backend selection', () => {
  it('prefers Vercel Blob when the write token is configured', () => {
    const prev = process.env.BLOB_READ_WRITE_TOKEN;
    process.env.BLOB_READ_WRITE_TOKEN = 'demo-token';
    try {
      const store = new Keystore('unused-local-dir');
      expect(store.storageKind()).toBe('blob');
    } finally {
      if (prev === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
      else process.env.BLOB_READ_WRITE_TOKEN = prev;
    }
  });
});

describe('encoding', () => {
  it('refuses non-canonical base64url', () => {
    expect(() => fromB64u('QQ')).not.toThrow();
    expect(() => fromB64u('QR')).toThrow(); // decodes to the same byte as "QQ" but is not canonical
    expect(() => fromB64u('a+b/')).toThrow();
  });
});
