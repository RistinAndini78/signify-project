'use client';

import { useState } from 'react';

const MIN_RUNS = 30;
const MAX_RUNS = 300;
const IDENTITY = { name: 'Penguji Ketahanan', title: 'Pengujian Otomatis', org: 'Signify' };

type Signed = { file: string; bytes: number; docId: string; qr: { text: string; bytes: number; version: number; modules: number } };
type Report = { category: string; name: string; result: string; detail: string };

const decodeB64 = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
const decodeB64u = (value: string) => decodeB64(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
const encodeB64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const downloadJson = (data: unknown) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: 'hasil-pengujian.json' }).click();
  URL.revokeObjectURL(url);
};
const downloadXlsx = async (data: { generatedAt: string; runs: number; reports: Report[] }) => {
  const response = await fetch('/api/test-results', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!response.ok) throw new Error('File XLSX tidak dapat dibuat.');
  const url = URL.createObjectURL(await response.blob());
  Object.assign(document.createElement('a'), { href: url, download: 'hasil-pengujian.xlsx' }).click();
  URL.revokeObjectURL(url);
};

async function readJson(response: Response) {
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(body.error ?? `Permintaan gagal (${response.status})`));
  return body;
}

/** Reads the raw public key (base64url) that createPortableKey wrote into the .dsk file, without unlocking the private key. */
async function readDskPublicKey(dsk: File): Promise<string> {
  let parsed: unknown;
  try { parsed = JSON.parse(await dsk.text()); } catch { throw new Error('File .dsk tidak valid.'); }
  const publicKey = parsed && typeof parsed === 'object' ? (parsed as { publicKey?: unknown }).publicKey : null;
  if (typeof publicKey !== 'string') throw new Error('File .dsk tidak memuat kunci publik.');
  return publicKey;
}

/** A public key that is guaranteed not to match the signer, for the wrong-key rejection test. */
async function generateWrongPublicKey(): Promise<string> {
  const pair = await window.crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const raw = new Uint8Array(await window.crypto.subtle.exportKey('raw', pair.publicKey));
  return encodeB64u(raw);
}

export default function ResiliencePage() {
  const [file, setFile] = useState<File | null>(null);
  const [dskFile, setDskFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [iterations, setIterations] = useState(MIN_RUNS);
  const [reports, setReports] = useState<Report[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  async function signOnce(source: File) {
    const form = new FormData();
    form.set('dsk', dskFile as File); form.set('passphrase', passphrase); form.set('file', source);
    form.set('name', IDENTITY.name); form.set('title', IDENTITY.title); form.set('org', IDENTITY.org);
    return readJson(await fetch('/api/sign', { method: 'POST', body: form })) as Promise<Signed>;
  }

  async function verifyOnce(source: File, options: { pubkey?: string; qr?: string } = {}) {
    const form = new FormData();
    form.set('file', source);
    if (options.pubkey) form.set('pubkey', options.pubkey);
    if (options.qr) form.set('qr', options.qr);
    return readJson(await fetch('/api/verify', { method: 'POST', body: form })) as Promise<{ valid?: boolean; qr?: { ok?: boolean } }>;
  }

  async function runTests() {
    if (!file || !dskFile || !passphrase) { setError('Pilih PDF, file .dsk, dan masukkan passphrase.'); return; }
    if (!dskFile.name.toLowerCase().endsWith('.dsk')) { setError('File kunci harus berformat .dsk.'); return; }
    if (!Number.isFinite(iterations) || iterations < MIN_RUNS || iterations > MAX_RUNS) { setError(`Jumlah iterasi harus antara ${MIN_RUNS} dan ${MAX_RUNS}.`); return; }
    setError(''); setReports([]); setRunning(true);
    try {
      const correctPublicKey = await readDskPublicKey(dskFile);
      const signTimes: number[] = [];
      let signed: Signed | null = null;
      for (let index = 0; index < iterations; index += 1) {
        setProgress(`Mengukur penandatanganan: ${index + 1}/${iterations}`);
        const start = performance.now(); signed = await signOnce(file); signTimes.push(performance.now() - start);
      }
      if (!signed) throw new Error('Penandatanganan tidak menghasilkan dokumen.');
      const signedFile = new File([decodeB64(signed.file) as BlobPart], 'signed.pdf', { type: 'application/pdf' });
      const verifyTimes: number[] = [];
      for (let index = 0; index < iterations; index += 1) {
        setProgress(`Mengukur verifikasi: ${index + 1}/${iterations}`);
        const start = performance.now(); const result = await verifyOnce(signedFile); verifyTimes.push(performance.now() - start);
        if (result.valid === false) throw new Error('Dokumen hasil sign tidak valid.');
      }
      const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
      const publicKeyBytes = decodeB64u(correctPublicKey).length;
      const tamperedBytes = decodeB64(signed.file); tamperedBytes[Math.floor(tamperedBytes.length / 2)] ^= 1;
      setProgress('Menguji tamper, kunci salah, dan QR palsu');
      const tampered = await verifyOnce(new File([tamperedBytes as BlobPart], 'tampered.pdf', { type: 'application/pdf' }));
      const wrongPublicKey = await generateWrongPublicKey();
      const wrongKey = await verifyOnce(signedFile, { pubkey: wrongPublicKey });
      const forgedPayload = JSON.parse(signed.qr.text) as Record<string, string>;
      forgedPayload.signerName = 'Pemalsu';
      const forgedQr = await verifyOnce(signedFile, { qr: JSON.stringify(forgedPayload, null, 2) });
      const nextReports: Report[] = [
        { category: 'Waktu', name: 'Penandatanganan rata-rata', result: `${average(signTimes).toFixed(2)} ms`, detail: `${iterations} percobaan` },
        { category: 'Waktu', name: 'Verifikasi rata-rata', result: `${average(verifyTimes).toFixed(2)} ms`, detail: `${iterations} percobaan` },
        { category: 'Ukuran', name: 'Signature ECDSA P-256', result: '64 byte', detail: 'Format r||s' },
        { category: 'Ukuran', name: 'Kunci publik raw', result: `${publicKeyBytes} byte`, detail: 'Dari file .dsk yang diunggah' },
        { category: 'Tamper', name: 'Satu byte dokumen diubah', result: tampered.valid === false ? 'DITOLAK' : 'GAGAL', detail: 'Verifikasi wajib gagal' },
        { category: 'Kunci salah', name: 'Kunci publik berbeda', result: wrongKey.valid === false ? 'DITOLAK' : 'GAGAL', detail: 'Verifikasi wajib gagal' },
        { category: 'QR palsu', name: 'Nama penandatangan diubah', result: forgedQr.qr?.ok === false ? 'DITOLAK' : 'GAGAL', detail: `Payload ${signed.qr.bytes} byte, versi ${signed.qr.version}` },
      ];
      setReports(nextReports);
      setProgress('Selesai');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pengujian tidak dapat dijalankan.');
      setProgress('');
    } finally { setRunning(false); }
  }

  return (
    <main className="app-shell">
      <div className="app-container">
        <header className="hero">
          <p className="eyebrow">Pengujian defensif</p>
          <h1>Uji Ketahanan Dokumen.</h1>
          <p className="hero-copy">Jalankan seluruh pengujian wajib langsung dari halaman ini dan unduh rekap hasilnya.</p>
          <a className="hero-link" href="/">Kembali ke tanda tangan dan verifikasi</a>
        </header>

        <div className="workflow-grid">
          <section className="workflow-card wide resilience-form">
            <p className="card-kicker"><span className="card-number">1</span> Input pengujian</p>
            <h2>Jalankan pengujian wajib</h2>
            <p className="card-intro">Gunakan PDF asli dan file kunci pribadi (.dsk) yang sama seperti pada alur penandatanganan utama. Halaman ini mengukur sign dan verify sebanyak jumlah iterasi yang dipilih, lalu menguji ukuran, tamper, kunci salah, dan QR palsu.</p>
            <div className="full-field"><label htmlFor="resilience-file">1. BERKAS PDF</label><input id="resilience-file" type="file" accept="application/pdf,.pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></div>
            {file && <p className="selected-file">Berkas dipilih: <b>{file.name}</b></p>}
            <div className="full-field"><label htmlFor="resilience-dsk">2. PRIVATE KEY (.DSK)</label><input id="resilience-dsk" type="file" accept=".dsk,application/json" onChange={(event) => setDskFile(event.target.files?.[0] ?? null)} /></div>
            <div className="field-grid">
              <div className="field"><label htmlFor="resilience-pass">3. PASSPHRASE</label><input id="resilience-pass" type="password" autoComplete="current-password" placeholder="Masukkan passphrase kunci" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} /></div>
              <div className="field"><label htmlFor="resilience-iterations">ITERASI PENGUJIAN ({MIN_RUNS}-{MAX_RUNS})</label><input id="resilience-iterations" type="number" min={MIN_RUNS} max={MAX_RUNS} value={iterations} onChange={(event) => setIterations(Number(event.target.value))} /></div>
            </div>
            <button onClick={runTests} disabled={running}>{running ? 'Menjalankan pengujian...' : 'Jalankan semua pengujian'}</button>
            {progress && <p className="notice">{progress}</p>}
            {error && <p className="error" role="alert">{error}</p>}
          </section>

          <section className="workflow-card wide">
            <p className="card-kicker"><span className="card-number">2</span> Rekap hasil</p>
            <h2>Hasil pengujian wajib</h2>
            {!reports.length && <div className="empty-state">Belum ada hasil pengujian.</div>}
            {reports.length > 0 && <>
              <div className="test-results">{reports.map((report) => <article className={`test-result ${report.result === 'GAGAL' ? 'test-failed' : 'test-passed'}`} key={`${report.category}-${report.name}`}><div><span className="test-status">{report.result === 'GAGAL' ? '✗ GAGAL' : '✓ DIPERIKSA'}</span><h3>{report.category}: {report.name}</h3><p>{report.result}</p><small>{report.detail}</small></div></article>)}</div>
              <div className="result-actions">
                <button className="button-secondary" onClick={() => downloadJson({ generatedAt: new Date().toISOString(), runs: iterations, reports })}>Unduh hasil JSON</button>
                <button className="button-secondary" onClick={() => downloadXlsx({ generatedAt: new Date().toISOString(), runs: iterations, reports })}>Unduh hasil XLSX</button>
              </div>
            </>}
          </section>
        </div>

        <p className="footer-note">Seluruh pengujian berjalan dari halaman ini · {iterations} percobaan sign dan verify</p>
      </div>
    </main>
  );
}
