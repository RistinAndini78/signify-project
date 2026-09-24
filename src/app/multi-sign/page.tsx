'use client';

import { useEffect, useState } from 'react';

interface Key { id: string; name: string; title: string; org: string; fp: string }
interface Signed { file: string; bytes: number; docId: string; signers: number; qr: { png: string; version: number; modules: number } }
interface SignerRow { name: string; title: string; org: string; fp: string; }

const fromB64 = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

function download(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}

export default function MultiSignPage() {
  const [keys, setKeys] = useState<Key[]>([]);
  const [keyId, setKeyId] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [signed, setSigned] = useState<Signed | null>(null);
  const [rows, setRows] = useState<SignerRow[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch('/api/keys').then((response) => response.json()).then((data) => {
      const available = data.keys ?? [];
      setKeys(available);
      if (available[0]) setKeyId(available[0].id);
    });
  }, []);

  function chooseInitialFile(next: File | null) {
    setError('');
    if (next && !next.name.toLowerCase().endsWith('.pdf')) {
      setFile(null);
      setError('Hanya file PDF yang dapat ditandatangani.');
      return;
    }
    setFile(next);
    setSigned(null);
    setRows([]);
  }

  async function addSignature() {
    setError('');
    if (!file || !keyId || !passphrase) {
      setError('Pilih PDF, kunci penandatangan, dan masukkan password.');
      return;
    }
    setBusy(true);
    const form = new FormData();
    form.set('keyId', keyId);
    form.set('passphrase', passphrase);
    form.set('file', file);
    try {
      const response = await fetch('/api/sign', { method: 'POST', body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Tanda tangan gagal.');
      const signer = keys.find((key) => key.id === keyId);
      setRows((current) => [...current, signer ? { name: signer.name, title: signer.title, org: signer.org, fp: signer.fp } : { name: 'Signer', title: '-', org: '-', fp: '-' }]);
      setSigned(data);
      setFile(new File([fromB64(data.file)], `signed-${data.signers}.pdf`, { type: 'application/pdf' }));
      setPassphrase('');
      const next = keys.find((key) => key.id !== keyId && !rows.some((row) => row.fp === key.fp));
      if (next) setKeyId(next.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Tanda tangan gagal.');
    } finally {
      setBusy(false);
    }
  }

  const downloadName = signed ? `Siliwangi-Disign-${signed.signers}-penandatangan.signed.pdf` : 'Siliwangi-Disign.signed.pdf';

  return (
    <main className="app-shell">
      <div className="app-container">
        <header className="hero">
          <p className="eyebrow">Siliwangi-Disign</p>
          <h1>Multi-tanda tangan.</h1>
          <p className="hero-copy">Tambahkan tanda tangan secara berurutan. Setiap signer menandatangani dokumen yang sudah memuat signature sebelumnya.</p>
          <a className="hero-link" href="/">Kembali ke tanda tangan dan verifikasi</a>
        </header>

        <div className="multi-page-layout">
          <section className="workflow-card">
            <p className="card-kicker"><span className="card-number">1</span> Dokumen berantai</p>
            <h2>Siapkan penandatangan</h2>
            <p className="card-intro">Mulai dari PDF asli. Setelah satu signer selesai, file signed otomatis menjadi input untuk signer berikutnya.</p>
            <div className="full-field"><label htmlFor="multi-file">Dokumen PDF awal</label><input id="multi-file" type="file" accept="application/pdf,.pdf" onChange={(event) => chooseInitialFile(event.target.files?.[0] ?? null)} /></div>
            <div className="field"><label htmlFor="multi-key">Kunci signer</label><select id="multi-key" value={keyId} onChange={(event) => setKeyId(event.target.value)}>{keys.map((key) => <option key={key.id} value={key.id}>{key.name} ({key.fp})</option>)}</select></div>
            <div className="field"><label htmlFor="multi-pass">Password kunci</label><input id="multi-pass" type="password" placeholder="Masukkan password signer" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} /></div>
            {file && <div className="co-signing-status"><b>{signed ? 'Dokumen lanjutan siap' : 'PDF awal siap'}</b><span>{file.name}</span><small>{signed ? 'Pilih signer berikutnya, masukkan password, lalu tambahkan tanda tangan.' : 'Signer pertama akan menjadi awal rantai signature.'}</small></div>}
            <button onClick={addSignature} disabled={busy}>{busy ? 'Memproses...' : signed ? 'Tambah tanda tangan signer ini' : 'Tanda tangani signer pertama'}</button>
            {error && <p className="error" role="alert">{error}</p>}
          </section>

          <aside className="workflow-card signer-timeline">
            <p className="card-kicker"><span className="card-number">2</span> Rantai signature</p>
            <h2>Urutan signer</h2>
            <p className="card-intro">Signature tidak ditimpa. Setiap tahap menambah blok baru di akhir dokumen.</p>
            {rows.length === 0 ? <div className="empty-state">Belum ada signer. Tanda tangani PDF untuk memulai.</div> : <ol className="signer-list">{rows.map((row, index) => <li key={`${row.fp}-${index}`}><span className="timeline-dot">{index + 1}</span><div><b>{row.name}</b><small>{row.title} · {row.org}</small><code>{row.fp}</code></div></li>)}</ol>}
          </aside>
        </div>

        {signed && <section className="workflow-card multi-result"><div><p className="card-kicker"><span className="card-number">3</span> Hasil terbaru</p><h2>{signed.signers} penandatangan tersimpan</h2><p className="card-intro">Dokumen sudah memiliki rantai signature dan dapat diteruskan ke signer berikutnya.</p><button onClick={() => download(downloadName, fromB64(signed.file))}>Unduh PDF bertanda tangan</button></div><img className="qr-image" alt="QR-Code dokumen" src={`data:image/png;base64,${signed.qr.png}`} /></section>}
        <p className="footer-note"><a href="/">Kembali ke tanda tangan dan verifikasi</a></p>
      </div>
    </main>
  );
}
