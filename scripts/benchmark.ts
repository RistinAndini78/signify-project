// Runs the mandatory tests of topic D and writes data-uji/hasil/hasil-pengujian.xlsx and hasil.json.
// Usage: npm run bench   (about a minute; scrypt is slow on purpose)
import { createHash, randomBytes, sign as nodeSign } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { b64u, fromB64u } from '../src/lib/sig/encoding';
import { encodeBlock, parseBlocks } from '../src/lib/sig/format';
import { fingerprint, generateKeyPair, openPrivateKey, rawPublic, sealPrivateKey, signMessage, verifyMessage } from '../src/lib/sig/keys';
import { parseQr, qrText } from '../src/lib/sig/qr';
import { Signer, signDocument, verifyDocument } from '../src/lib/sig/service';

const root = join(__dirname, '..');
const INPUT = join(root, 'data-uji', 'input'), OUT = join(root, 'data-uji', 'hasil');
for (const d of [INPUT, OUT]) mkdirSync(d, { recursive: true });

const ORIGIN = 'http://localhost:3000';
const r4 = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
const now = () => Number(process.hrtime.bigint()) / 1e6;

function stats(xs: number[]) {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return { n: xs.length, mean, sd: Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length), min: Math.min(...xs), max: Math.max(...xs) };
}
async function time(fn: () => unknown | Promise<unknown>, runs: number) {
  await fn();
  const xs: number[] = [];
  for (let i = 0; i < runs; i++) { const t = now(); await fn(); xs.push(now() - t); }
  return stats(xs);
}
const row = (label: string, s: ReturnType<typeof stats>) => [label, s.n, r4(s.mean), r4(s.sd), r4(s.min), r4(s.max)];

const wb = new ExcelJS.Workbook();
function sheet(name: string, header: string[], rows: (string | number)[][], note?: string) {
  const ws = wb.addWorksheet(name);
  if (note) { ws.addRow([note]); ws.addRow([]); }
  ws.addRow(header).font = { bold: true };
  rows.forEach((r) => ws.addRow(r));
  ws.columns.forEach((c) => { c.width = 26; });
}
const json: Record<string, unknown> = {};

async function pdf(pages: number, words = 40): Promise<Buffer> {
  const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < pages; p++) {
    const page = d.addPage([595, 842]);
    for (let l = 0; l < 40; l++) page.drawText(`Halaman ${p + 1} baris ${l + 1}: ${'surat keterangan resmi '.repeat(Math.ceil(words / 8))}`.slice(0, 95), { x: 40, y: 800 - l * 18, size: 10, font: f });
  }
  return Buffer.from(await d.save({ useObjectStreams: false }));
}
const mk = (name: string, title = 'Dosen'): Signer => ({ ...generateKeyPair(), name, title, org: 'Universitas Siliwangi' });

async function main() {
  // ---------- 1. Key generation, sealing, unlocking ----------
  const gen: number[] = [];
  for (let i = 0; i < 100; i++) { const t = now(); generateKeyPair(); gen.push(now() - t); }
  const kp = generateKeyPair(), fp = fingerprint(rawPublic(kp.publicKey));
  const sealT = await time(() => sealPrivateKey(kp.privateKey, fp, 'kata-sandi-rahasia'), 30);
  const sealed = sealPrivateKey(kp.privateKey, fp, 'kata-sandi-rahasia');
  const openT = await time(() => openPrivateKey(sealed, fp, 'kata-sandi-rahasia'), 30);
  sheet('1 Pembangkitan kunci', ['Operasi', 'Ulangan', 'Rerata (ms)', 'SD (ms)', 'Min (ms)', 'Maks (ms)'],
    [row('Bangkitkan pasangan kunci ECDSA P-256', stats(gen)), row('Enkripsi kunci privat (scrypt N=2^15 + AES-256-GCM)', sealT), row('Buka kunci privat dengan kata sandi', openT)],
    'Kunci privat tidak pernah ditulis polos: hanya bentuk terenkripsi (PKCS#8 dalam AES-256-GCM, kunci dari kata sandi dengan scrypt) yang disimpan.');
  console.log('keys done');

  // ---------- 2. Sizes ----------
  const msg = 'KRIPTO-DOC1|' + 'a'.repeat(64) + '|id|fp|["n","t","o","2026-09-24T00:00:00.000Z"]';
  const der = nodeSign('sha256', Buffer.from(msg), kp.privateKey); // DER, for comparison only
  const raw = rawPublic(kp.publicKey);
  const spki = kp.publicKey.export({ format: 'der', type: 'spki' }), pem = kp.publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const doc = await pdf(3);
  const signer = mk('Dr. Alam Rahmatulloh', 'Dosen Pengampu');
  const s1 = await signDocument(doc, signer, ORIGIN);
  const blockBytes = encodeBlock(s1.block).length;
  const sizes: (string | number)[][] = [
    ['Tanda tangan ECDSA P-256 (r||s, dipakai)', 64, 'tetap 64 B'],
    ['Tanda tangan format DER (pembanding)', der.length, '70-72 B, bervariasi'],
    ['Kunci publik, titik terkompresi tidak (dipakai)', raw.length, '0x04 || x || y'],
    ['Kunci publik SPKI DER', spki.length, ''],
    ['Kunci publik PEM (karakter)', pem.length, ''],
    ['Blok tanda tangan di akhir berkas (B)', blockBytes, 'metadata + kunci publik + 2 tanda tangan + hash'],
    ['Payload QR-Code (B)', s1.qr.bytes, `versi ${s1.qr.version}, ${s1.qr.modules}x${s1.qr.modules} modul, koreksi kesalahan M`],
    ['PDF asli (3 halaman)', doc.length, ''],
    ['PDF setelah halaman QR dan 1 blok', s1.file.length, `tambahan ${s1.file.length - doc.length} B`],
  ];
  sheet('2 Ukuran', ['Objek', 'Ukuran', 'Keterangan'], sizes);
  json.sizes = sizes;
  console.log('sizes done');

  // ---------- 3. Timing: >= 30 runs ----------
  const timing: (string | number)[][] = [];
  const RUNS = 200;
  const sigOnly = await time(() => signMessage(kp.privateKey, msg), RUNS);
  const sig = signMessage(kp.privateKey, msg);
  const verOnly = await time(() => verifyMessage(kp.publicKey, msg, sig), RUNS);
  timing.push(row('ECDSA sign (pesan pendek)', sigOnly), row('ECDSA verify (pesan pendek)', verOnly));
  const hashRows: (string | number)[][] = [];
  for (const [label, size, runs] of [['1 KB', 1024, 300], ['100 KB', 102400, 100], ['1 MB', 1 << 20, 50], ['10 MB', 10 << 20, 30]] as const) {
    const data = randomBytes(size);
    const h = await time(() => createHash('sha256').update(data).digest(), runs);
    const sd = await time(() => signDocument(data, signer, ORIGIN), Math.min(runs, 40));
    const signed = (await signDocument(data, signer, ORIGIN)).file;
    const vd = await time(() => verifyDocument(signed), Math.min(runs, 40));
    hashRows.push([label, r4(h.mean), r4(sd.mean), r4(sd.sd), r4(vd.mean), r4(vd.sd), sd.n]);
  }
  sheet('3 Waktu sign dan verify', ['Operasi', 'Ulangan', 'Rerata (ms)', 'SD (ms)', 'Min (ms)', 'Maks (ms)'], timing, `Setiap baris memakai lebih dari 30 ulangan (${RUNS}). Node ${process.version}.`);
  sheet('3b Berkas berbagai ukuran', ['Ukuran berkas', 'SHA-256 saja (ms)', 'Sign dokumen lengkap (ms)', 'SD sign (ms)', 'Verify dokumen lengkap (ms)', 'SD verify (ms)', 'Ulangan sign'], hashRows,
    'Berkas biner acak (bukan PDF: tanpa halaman QR). Sign dan verify lengkap = hash, dua tanda tangan ECDSA, blok, serta pemeriksaan.');
  const pdfRows: (string | number)[][] = [];
  for (const pages of [1, 5, 20]) {
    const p = await pdf(pages);
    const sd = await time(() => signDocument(p, signer, ORIGIN), 30);
    const signed = (await signDocument(p, signer, ORIGIN)).file;
    const vd = await time(() => verifyDocument(signed), 30);
    pdfRows.push([`PDF ${pages} halaman (${p.length} B)`, r4(sd.mean), r4(sd.sd), r4(vd.mean), r4(vd.sd)]);
  }
  sheet('3c PDF', ['Dokumen', 'Sign lengkap: rerata (ms)', 'SD (ms)', 'Verify: rerata (ms)', 'SD (ms)'], pdfRows, '30 ulangan tiap baris. Sign PDF termasuk pembuatan QR-Code dan halaman pengesahan.');
  json.timing = { sigOnly, verOnly, hashRows, pdfRows };
  console.log('timing done');

  // ---------- 4. Tamper tests ----------
  const tamperSource = await pdf(3);
  const tamperSigned = (await signDocument(tamperSource, signer, ORIGIN)).file;
  const tamperStart = parseBlocks(tamperSigned)[0].start;
  const tampered = Buffer.from(tamperSigned);
  tampered[Math.floor(tamperStart / 2)] ^= 1;
  const tamperRejected = !verifyDocument(tampered).valid;
  const tamper: (string | number)[][] = [['PDF 3 halaman', tamperSigned.length, '1 byte isi dokumen diubah', tamperRejected ? 'ditolak' : 'DITERIMA (GAGAL)']];
  sheet('4 Uji tamper', ['Dokumen', 'Ukuran bertanda tangan (B)', 'Perubahan', 'Hasil verifikasi'], tamper,
    'Satu byte pada isi dokumen bertanda tangan diubah. Verifikasi wajib menolak hasil perubahan.');
  if (!tamperRejected) throw new Error('tampered document was accepted');
  json.tamper = tamper;
  console.log('tamper done');

  // ---------- 5. Wrong key ----------
  const wk: (string | number)[][] = [];
  const good = await signDocument(await pdf(2), signer, ORIGIN);
  const wrongKey = generateKeyPair().publicKey;
  const wrongKeyRejected = !verifyDocument(good.file, { publicKey: wrongKey }).valid;
  wk.push(['Kunci publik yang salah', wrongKeyRejected ? 'ditolak' : 'DITERIMA (GAGAL)'], ['Kunci publik yang benar', verifyDocument(good.file, { publicKey: signer.publicKey }).valid ? 'diterima' : 'GAGAL']);
  sheet('5 Uji kunci salah', ['Skenario', 'Hasil'], wk, 'Kunci publik yang tidak cocok menghasilkan kegagalan. Nama yang sama tidak berarti kunci yang sama: identitas dinilai dari sidik jari kunci terdaftar.');
  if (!wrongKeyRejected) throw new Error('wrong public key was accepted');
  json.wrongKey = wk;
  console.log('wrong key done');

  // ---------- 6. Forged QR ----------
  const q = parseQr(good.qr.text);
  const forged: (string | number)[][] = [];
  const check = (text: string) => { const v = verifyDocument(good.file, { qr: text }); return !!(v.qr && 'ok' in v.qr && v.qr.ok); };
  const fields: [string, (d: typeof q) => typeof q][] = [
    ['nama diubah', (d) => ({ ...d, meta: { ...d.meta, name: 'Penipu' } })], ['jabatan diubah', (d) => ({ ...d, meta: { ...d.meta, title: 'Rektor' } })],
    ['institusi diubah', (d) => ({ ...d, meta: { ...d.meta, org: 'Lembaga Lain' } })], ['waktu diubah', (d) => ({ ...d, meta: { ...d.meta, time: '2030-01-01T00:00:00.000Z' } })],
    ['ID dokumen diubah', (d) => ({ ...d, id: b64u(randomBytes(12)) })], ['sidik jari diubah', (d) => ({ ...d, fp: '0000000000000000' })],
  ];
  for (const [label, f] of fields) forged.push([label, check(qrText(f(q), ORIGIN)) ? 'DITERIMA (GAGAL)' : 'ditolak']);
  const sigBytes = fromB64u(q.sig);
  const forgedSignature = Buffer.from(sigBytes);
  forgedSignature[0] ^= 1;
  forged.push(['Signature pada QR diubah', check(qrText({ ...q, sig: b64u(forgedSignature) }, ORIGIN)) ? 'DITERIMA (GAGAL)' : 'ditolak']);
  forged.push(['QR asli', check(good.qr.text) ? 'diterima' : 'GAGAL']);
  sheet('6 Uji QR-Code palsu', ['Skenario', 'Hasil'], forged, `Payload QR ${good.qr.bytes} B (versi ${good.qr.version}, ${good.qr.modules}x${good.qr.modules} modul). QR memuat metadata dan tanda tangan atas metadata + ID dokumen; QR sah saja tidak membuktikan isi dokumen, itu tugas tanda tangan dokumen.`);
  if (forged.some((r) => String(r[1]).includes('GAGAL'))) throw new Error('forged QR accepted');
  json.forged = forged;
  console.log('forged done');

  json.keygen = { gen: stats(gen), sealT, openT };
  writeFileSync(join(OUT, 'hasil.json'), JSON.stringify(json, null, 2));
  const file = join(OUT, 'hasil-pengujian.xlsx');
  await wb.xlsx.writeFile(file);
  console.log(`written ${file}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
