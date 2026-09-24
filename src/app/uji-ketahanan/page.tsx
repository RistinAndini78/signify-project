'use client';

import { useState } from 'react';

type TestCase = {
  id: string;
  name: string;
  description: string;
  mutate: (bytes: Uint8Array) => Uint8Array;
};

type TestResult = {
  test: TestCase;
  file: File;
  rejected: boolean;
  detail: string;
};

const SIGNATURE_MARKER = new TextEncoder().encode('%KRIPTO-SIG-V1');

function download(file: File) {
  const url = URL.createObjectURL(file);
  Object.assign(document.createElement('a'), { href: url, download: file.name }).click();
  URL.revokeObjectURL(url);
}

function copyBytes(bytes: Uint8Array) {
  return new Uint8Array(bytes);
}

function findMarker(bytes: Uint8Array) {
  for (let index = 0; index <= bytes.length - SIGNATURE_MARKER.length; index += 1) {
    if (SIGNATURE_MARKER.every((value, offset) => bytes[index + offset] === value)) return index;
  }
  return -1;
}

const testCases: TestCase[] = [
  {
    id: 'flip-content',
    name: 'Ubah satu byte isi dokumen',
    description: 'Mengubah satu byte sebelum blok tanda tangan.',
    mutate: (bytes) => {
      const result = copyBytes(bytes);
      const marker = findMarker(result);
      const target = marker > 0 ? Math.floor(marker / 2) : Math.floor(result.length / 2);
      result[target] ^= 1;
      return result;
    },
  },
  {
    id: 'flip-signature',
    name: 'Ubah satu byte signature',
    description: 'Mengubah isi blok signature yang tersimpan di PDF.',
    mutate: (bytes) => {
      const result = copyBytes(bytes);
      const marker = findMarker(result);
      const target = marker >= 0 ? Math.min(marker + SIGNATURE_MARKER.length + 8, result.length - 1) : result.length - 1;
      result[target] ^= 1;
      return result;
    },
  },
  {
    id: 'truncate',
    name: 'Potong ekor dokumen',
    description: 'Menghapus 32 byte terakhir dari berkas.',
    mutate: (bytes) => bytes.slice(0, Math.max(1, bytes.length - 32)),
  },
  {
    id: 'append',
    name: 'Tambahkan data asing',
    description: 'Menambahkan byte baru setelah isi dokumen.',
    mutate: (bytes) => {
      const payload = new TextEncoder().encode('tampered-data');
      const result = new Uint8Array(bytes.length + payload.length);
      result.set(bytes);
      result.set(payload, bytes.length);
      return result;
    },
  },
];

export default function ResiliencePage() {
  const [file, setFile] = useState<File | null>(null);
  const [results, setResults] = useState<TestResult[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  async function runTests() {
    if (!file) {
      setError('Pilih PDF bertanda tangan terlebih dahulu.');
      return;
    }

    setError('');
    setResults([]);
    setRunning(true);
    try {
      const original = new Uint8Array(await file.arrayBuffer());
      const nextResults: TestResult[] = [];
      for (const test of testCases) {
        const mutated = new File([test.mutate(original) as BlobPart], `${file.name.replace(/\.pdf$/i, '')}.${test.id}.pdf`, { type: 'application/pdf' });
        const form = new FormData();
        form.set('file', mutated);
        const response = await fetch('/api/verify', { method: 'POST', body: form });
        const report = await response.json().catch(() => null) as { valid?: boolean; message?: string; error?: string } | null;
        const rejected = !response.ok || report?.valid === false;
        nextResults.push({ test, file: mutated, rejected, detail: report?.message ?? report?.error ?? (rejected ? 'Dokumen ditolak.' : 'Dokumen diterima.') });
        setResults([...nextResults]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pengujian tidak dapat dijalankan.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="app-shell">
      <div className="app-container">
        <header className="hero">
          <p className="eyebrow">Pengujian defensif</p>
          <h1>Uji Ketahanan Dokumen.</h1>
          <p className="hero-copy">Jalankan perubahan terkontrol pada PDF bertanda tangan untuk memastikan integritas dokumen selalu diperiksa dengan benar.</p>
          <a className="hero-link" href="/">Kembali ke tanda tangan dan verifikasi</a>
        </header>

        <div className="workflow-grid resilience-grid">
          <section className="workflow-card wide">
            <p className="card-kicker"><span className="card-number">1</span> Berkas pengujian</p>
            <h2>Simulasi perubahan otomatis</h2>
            <p className="card-intro">Pilih PDF bertanda tangan milik Anda. Semua perubahan dibuat di browser dan tidak mengubah berkas asli.</p>
            <div className="full-field"><label htmlFor="resilience-file">PDF bertanda tangan</label><input id="resilience-file" type="file" accept="application/pdf,.pdf" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setResults([]); setError(''); }} /></div>
            {file && <div className="test-file"><b>{file.name}</b><span>{file.size.toLocaleString('id-ID')} byte</span></div>}
            <button onClick={runTests} disabled={running}>{running ? 'Menjalankan pengujian...' : 'Jalankan semua pengujian'}</button>
            {error && <p className="error" role="alert">{error}</p>}
            <p className="notice">Tujuan setiap skenario adalah membuat verifikasi menolak dokumen. Hasil ini tidak menyerang sistem lain dan hanya memakai file yang Anda pilih.</p>
          </section>

          <section className="workflow-card wide">
            <p className="card-kicker"><span className="card-number">2</span> Hasil pemeriksaan</p>
            <h2>Ketahanan terhadap perubahan</h2>
            {!results.length && <div className="empty-state">Belum ada hasil. Jalankan pengujian untuk melihat apakah setiap perubahan terdeteksi.</div>}
            {results.length > 0 && <div className="test-results">{results.map((result) => <article className={`test-result ${result.rejected ? 'test-passed' : 'test-failed'}`} key={result.test.id}>
              <div><span className="test-status">{result.rejected ? '✓ TERDETEKSI' : '✗ TIDAK TERDETEKSI'}</span><h3>{result.test.name}</h3><p>{result.test.description}</p><small>{result.detail}</small></div>
              <button className="button-secondary" onClick={() => download(result.file)}>Unduh hasil</button>
            </article>)}</div>}
          </section>
        </div>
        <p className="footer-note">Pengujian lokal · Perubahan dibuat otomatis · File asli tidak diubah</p>
      </div>
    </main>
  );
}