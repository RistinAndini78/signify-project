'use client';

import { useState } from 'react';

interface Signed {
  file: string; bytes: number; docId: string; signers: number;
  qr: {
    png: string; text: string; version: number; modules: number;
    codes: { png: string; text: string; version: number; modules: number; bytes: number; signer: { name: string; title: string; org: string; time: string; fp: string } }[];
  };
}
interface SignerRow { name: string; title: string; org: string; fp: string }
interface StagedSigner extends SignerRow { dskFile: File; passphrase: string }

const fromB64 = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

function download(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}

export default function MultiSignPage() {
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [dskFile, setDskFile] = useState<File | null>(null);
  const [dskInputKey, setDskInputKey] = useState(0);
  const [passphrase, setPassphrase] = useState('');
  const [identity, setIdentity] = useState({ name: '', title: '', org: '' });
  const [rows, setRows] = useState<SignerRow[]>([]);
  const [staged, setStaged] = useState<StagedSigner[]>([]);
  const [signed, setSigned] = useState<Signed | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function chooseInitialFile(next: File | null) {
    setError('');
    if (next && !next.name.toLowerCase().endsWith('.pdf')) {
      setError('Hanya file PDF yang dapat ditandatangani.');
      return;
    }
    setCurrentFile(next);
    setSigned(null);
    setRows([]);
    setStaged([]);
    setDskFile(null);
    setDskInputKey((key) => key + 1);
    setPassphrase('');
    setIdentity({ name: '', title: '', org: '' });
  }

  function startNewChain() {
    setCurrentFile(null);
    setSigned(null);
    setRows([]);
    setStaged([]);
    setDskFile(null);
    setDskInputKey((key) => key + 1);
    setPassphrase('');
    setIdentity({ name: '', title: '', org: '' });
    setError('');
  }

  async function addSigner() {
    setError('');
    if (!currentFile || signed) {
      setError('Pilih PDF asli untuk memulai rantai baru.');
      return;
    }
    if (!dskFile || !passphrase || !identity.name.trim() || !identity.title.trim() || !identity.org.trim()) {
      setError('Lengkapi file .dsk, passphrase, nama, jabatan, dan institusi.');
      return;
    }
    if (rows.length >= 12) {
      setError('Batas maksimum adalah 12 signer dalam satu dokumen.');
      return;
    }
    if (!dskFile.name.toLowerCase().endsWith('.dsk')) {
      setError('File kunci harus berformat .dsk.');
      return;
    }
    setBusy(true);
    try {
      const portable = JSON.parse(await dskFile.text()) as { fp?: unknown };
      if (typeof portable.fp !== 'string' || !/^[0-9a-f]{16}$/.test(portable.fp)) throw new Error('File .dsk tidak memiliki sidik jari yang valid.');
      if (rows.some((row) => row.fp === portable.fp)) throw new Error('Kunci ini sudah dipilih untuk signer lain. Gunakan kunci berbeda.');
      const signer = { ...identity, name: identity.name.trim(), title: identity.title.trim(), org: identity.org.trim(), fp: portable.fp, dskFile, passphrase };
      setStaged((current) => [...current, signer]);
      setRows((current) => [...current, { name: signer.name, title: signer.title, org: signer.org, fp: signer.fp }]);
      setDskFile(null);
      setDskInputKey((key) => key + 1);
      setPassphrase('');
      setIdentity({ name: '', title: '', org: '' });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Signer tidak dapat ditambahkan.');
    } finally {
      setBusy(false);
    }
  }

  async function finalizeSignatures() {
    setError('');
    if (!currentFile || staged.length < 2) {
      setError('Tambahkan sedikitnya dua signer sebelum finalisasi.');
      return;
    }
    setBusy(true);
    const form = new FormData();
    form.set('file', currentFile);
    form.set('signers', JSON.stringify(staged.map(({ name, title, org }) => ({ name, title, org }))));
    staged.forEach((signer, index) => {
      form.set(`dsk-${index}`, signer.dskFile);
      form.set(`passphrase-${index}`, signer.passphrase);
    });
    try {
      const response = await fetch('/api/sign', { method: 'POST', body: form });
      const data = await response.json() as Signed & { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Finalisasi tanda tangan gagal.');
      setSigned(data);
      setStaged([]);
      setDskFile(null);
      setPassphrase('');
      setIdentity({ name: '', title: '', org: '' });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Finalisasi tanda tangan gagal.');
    } finally {
      setBusy(false);
    }
  }

  const signerNumber = rows.length + 1;
  const downloadName = `multi-sign-${signed?.signers ?? 0}-penandatangan.signed.pdf`;

  return (
    <main className="app-shell">
      <div className="app-container">
        <header className="hero">
          <p className="eyebrow">Siliwangi-Disign</p>
          <h1>Multi-tanda tangan.</h1>
          <p className="hero-copy">Kumpulkan signer, lalu finalisasi PDF dengan satu QR untuk setiap signer dan signature yang terverifikasi.</p>
          <a className="hero-link" href="/">Kembali ke tanda tangan dan verifikasi</a>
        </header>

        <div className="multi-page-layout">
          <section className="workflow-card">
            <p className="card-kicker"><span className="card-number">{signerNumber}</span> Dokumen Berantai</p>
            <h2>{rows.length === 0 ? 'Siapkan penandatangan' : `Siapkan signer ${signerNumber}`}</h2>
            <p className="card-intro">Mulai dari PDF asli. Tambahkan semua signer, lalu buat dokumen final dengan seluruh QR-Code dan signature berantai.</p>

            {!signed && <div className="full-field"><label htmlFor="multi-file">Dokumen PDF asli</label><input id="multi-file" type="file" accept="application/pdf,.pdf" onChange={(event) => chooseInitialFile(event.target.files?.[0] ?? null)} /></div>}
            {currentFile && <div className="co-signing-status"><b>{signed ? 'PDF final selesai' : 'PDF asli siap'}</b><span>{currentFile.name}</span><small>{currentFile.size.toLocaleString('id-ID')} byte · kredensial signer hanya ditahan sementara pada sesi halaman ini</small></div>}

            {currentFile && !signed && <>
              <div className="full-field"><label htmlFor={`multi-dsk-${dskInputKey}`}>File kunci privat (.dsk)</label><input key={dskInputKey} id={`multi-dsk-${dskInputKey}`} type="file" accept=".dsk,application/json" onChange={(event) => setDskFile(event.target.files?.[0] ?? null)} /></div>
              <div className="field"><label htmlFor="multi-pass">Kata sandi kunci</label><input id="multi-pass" type="password" autoComplete="current-password" placeholder="Passphrase untuk file .dsk" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} /></div>
              <div className="field"><label htmlFor="multi-name">Nama</label><input id="multi-name" placeholder="Nama lengkap signer" value={identity.name} onChange={(event) => setIdentity({ ...identity, name: event.target.value })} /></div>
              <div className="field"><label htmlFor="multi-title">Jabatan</label><input id="multi-title" placeholder="Jabatan signer" value={identity.title} onChange={(event) => setIdentity({ ...identity, title: event.target.value })} /></div>
              <div className="field"><label htmlFor="multi-org">Institusi</label><input id="multi-org" placeholder="Nama institusi" value={identity.org} onChange={(event) => setIdentity({ ...identity, org: event.target.value })} /></div>
              <button onClick={addSigner} disabled={busy}>{busy ? 'Menyiapkan signer...' : `Tambah signer ${signerNumber}`}</button>
              {staged.length >= 2 && <button className="button-secondary" onClick={finalizeSignatures} disabled={busy}>{busy ? 'Membuat PDF final...' : `Finalisasi ${staged.length} signer`}</button>}
            </>}
            {error && <p className="error" role="alert">{error}</p>}
            {rows.length > 0 && <button className="button-secondary reset-chain" onClick={startNewChain}>Buang draft / mulai rantai baru</button>}
          </section>

          <aside className="workflow-card signer-timeline">
            <p className="card-kicker"><span className="card-number">2</span> Rantai Signature</p>
            <h2>Urutan signer</h2>
            <p className="card-intro">Setiap signer mendapat QR sendiri. Semua QR dibuat sebelum signature dokumen difinalisasi.</p>
            {rows.length === 0 ? <div className="empty-state">Belum ada signer. Pilih PDF dan lakukan tanda tangan pertama.</div> : <ol className="signer-list">{rows.map((row, index) => <li key={`${row.fp}-${index}`}><span className="timeline-dot">{index + 1}</span><div><b>{row.name}</b><small>{row.title} · {row.org}</small><code>{row.fp}</code></div></li>)}</ol>}
          </aside>
        </div>

        {signed && <section className="workflow-card multi-result"><div><p className="card-kicker"><span className="card-number">3</span> Hasil final</p><h2>{signed.signers} penandatangan tersimpan</h2><p className="card-intro">PDF final memuat satu QR-Code untuk setiap signer dan seluruh signature berantai.</p><button onClick={() => download(downloadName, fromB64(signed.file))}>Unduh PDF bertanda tangan</button></div><div className="qr-pair">{signed.qr.codes.map((code, index) => <div key={`${code.signer.fp}-${index}`}><img className="qr-image" alt={`QR-Code signer ${index + 1}: ${code.signer.name}`} src={`data:image/png;base64,${code.png}`} /><small>{index + 1}. {code.signer.name}</small></div>)}</div></section>}
        <p className="footer-note">ECDSA P-256 · SHA-256 · QR verification</p>
      </div>
    </main>
  );
}
