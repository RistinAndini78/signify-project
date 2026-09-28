'use client';

import { useState } from 'react';

interface Signed {
  file: string; bytes: number; docId: string; signers: number;
  qr: { png: string; text: string; version: number; modules: number; secondary?: { png: string; signer: { name: string; title: string; org: string; time: string } } };
}
interface SignerRow { name: string; title: string; org: string; fp: string }

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
  const [signed, setSigned] = useState<Signed | null>(null);
  const [rows, setRows] = useState<SignerRow[]>([]);
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
    setDskFile(null);
    setDskInputKey((key) => key + 1);
    setPassphrase('');
    setIdentity({ name: '', title: '', org: '' });
  }

  function startNewChain() {
    setCurrentFile(null);
    setSigned(null);
    setRows([]);
    setDskFile(null);
    setDskInputKey((key) => key + 1);
    setPassphrase('');
    setIdentity({ name: '', title: '', org: '' });
    setError('');
  }

  async function addSignature() {
    setError('');
    if (!currentFile || !dskFile || !passphrase || !identity.name.trim() || !identity.title.trim() || !identity.org.trim()) {
      setError('Lengkapi file .dsk, passphrase, nama, jabatan, dan institusi.');
      return;
    }
    if (!dskFile.name.toLowerCase().endsWith('.dsk')) {
      setError('File kunci harus berformat .dsk.');
      return;
    }

    setBusy(true);
    const form = new FormData();
    form.set('dsk', dskFile);
    form.set('passphrase', passphrase);
    form.set('name', identity.name.trim());
    form.set('title', identity.title.trim());
    form.set('org', identity.org.trim());
    form.set('file', currentFile);
    try {
      const response = await fetch('/api/sign', { method: 'POST', body: form });
      const data = await response.json() as Signed & { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Tanda tangan gagal.');

      const qrInfo = JSON.parse(data.qr.text) as { publicKeyFingerprint?: string };
      const nextFile = new File([fromB64(data.file)], `multi-sign-${data.signers}.signed.pdf`, { type: 'application/pdf' });
      setCurrentFile(nextFile);
      setSigned(data);
      setRows((current) => [...current, {
        ...identity,
        fp: qrInfo.publicKeyFingerprint ?? 'sidik jari tidak tersedia',
      }]);
      setDskFile(null);
      setDskInputKey((key) => key + 1);
      setPassphrase('');
      setIdentity({ name: '', title: '', org: '' });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Tanda tangan gagal.');
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
          <p className="eyebrow">Signify</p>
          <h1>Multi-tanda tangan.</h1>
          <p className="hero-copy">PDF bertanda tangan diperbarui otomatis setiap kali signer menambahkan tanda tangan. File hasil tahap sebelumnya menjadi dokumen aktif untuk signer berikutnya.</p>
          <a className="hero-link" href="/">Kembali ke tanda tangan dan verifikasi</a>
        </header>

        <div className="multi-page-layout">
          <section className="workflow-card">
            <p className="card-kicker"><span className="card-number">{signerNumber}</span> {rows.length === 0 ? 'Dokumen awal' : `Penandatangan ${signerNumber}`}</p>
            <h2>{rows.length === 0 ? 'Mulai rantai tanda tangan' : `Tanda tangan sebagai signer ${signerNumber}`}</h2>
            <p className="card-intro">{rows.length === 0 ? 'Pilih PDF yang akan ditandatangani. Setelah signer pertama berhasil, hasilnya otomatis menjadi dokumen untuk signer selanjutnya.' : 'Dokumen yang tampil sudah memuat tanda tangan sebelumnya. Tambahkan kunci dan identitas Anda untuk melanjutkan rantai.'}</p>

            {rows.length === 0 && <div className="full-field"><label htmlFor="multi-file">PDF AWAL</label><input id="multi-file" type="file" accept="application/pdf,.pdf" onChange={(event) => chooseInitialFile(event.target.files?.[0] ?? null)} /></div>}
            {currentFile && <div className="co-signing-status"><b>{rows.length === 0 ? 'PDF awal siap' : `PDF hasil ${rows.length} signer siap`}</b><span>{currentFile.name}</span><small>{currentFile.size.toLocaleString('id-ID')} byte · dokumen aktif untuk signer berikutnya</small></div>}

            {currentFile && <>
              <div className="full-field"><label htmlFor={`multi-dsk-${dskInputKey}`}>PRIVATE KEY (.DSK)</label><input key={dskInputKey} id={`multi-dsk-${dskInputKey}`} type="file" accept=".dsk,application/json" onChange={(event) => setDskFile(event.target.files?.[0] ?? null)} /></div>
              <div className="field"><label htmlFor="multi-pass">PASSPHRASE</label><input id="multi-pass" type="password" autoComplete="current-password" placeholder="Passphrase untuk file .dsk" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} /></div>
              <div className="field"><label htmlFor="multi-name">NAMA</label><input id="multi-name" placeholder="Nama lengkap signer" value={identity.name} onChange={(event) => setIdentity({ ...identity, name: event.target.value })} /></div>
              <div className="field"><label htmlFor="multi-title">JABATAN</label><input id="multi-title" placeholder="Jabatan signer" value={identity.title} onChange={(event) => setIdentity({ ...identity, title: event.target.value })} /></div>
              <div className="field"><label htmlFor="multi-org">INSTITUSI</label><input id="multi-org" placeholder="Nama institusi" value={identity.org} onChange={(event) => setIdentity({ ...identity, org: event.target.value })} /></div>
              <button onClick={addSignature} disabled={busy}>{busy ? 'Memproses tanda tangan...' : `Tandatangani sebagai signer ${signerNumber}`}</button>
            </>}
            {error && <p className="error" role="alert">{error}</p>}
            {rows.length > 0 && <button className="button-secondary reset-chain" onClick={startNewChain}>Mulai rantai baru</button>}
          </section>

          <aside className="workflow-card signer-timeline">
            <p className="card-kicker"><span className="card-number">2</span> Rantai signature</p>
            <h2>Urutan signer</h2>
            <p className="card-intro">Setiap tanda tangan ditambahkan ke PDF aktif. Signer berikutnya tidak perlu mengunggah ulang dokumen.</p>
            {rows.length === 0 ? <div className="empty-state">Belum ada signer. Pilih PDF dan lakukan tanda tangan pertama.</div> : <ol className="signer-list">{rows.map((row, index) => <li key={`${row.fp}-${index}`}><span className="timeline-dot">{index + 1}</span><div><b>{row.name}</b><small>{row.title} · {row.org}</small><code>{row.fp}</code></div></li>)}</ol>}
          </aside>
        </div>

        {signed && <section className="workflow-card multi-result"><div><p className="card-kicker"><span className="card-number">3</span> Hasil terbaru</p><h2>{signed.signers} penandatangan tersimpan</h2><p className="card-intro">PDF aktif sudah diperbarui dan siap diunduh atau diteruskan ke signer berikutnya.</p><button onClick={() => download(downloadName, fromB64(signed.file))}>Unduh PDF bertanda tangan</button></div><div className="qr-pair"><div><img className="qr-image" alt="QR-Code signer terbaru" src={`data:image/png;base64,${signed.qr.png}`} /><small>Signer terbaru</small></div>{signed.qr.secondary && <div><img className="qr-image qr-image-mini" alt="QR-Code signer sebelumnya" src={`data:image/png;base64,${signed.qr.secondary.png}`} /><small>{signed.qr.secondary.signer.name}</small></div>}</div></section>}
        <p className="footer-note">ECDSA P-256 · SHA-256 · QR verification</p>
      </div>
    </main>
  );
}
