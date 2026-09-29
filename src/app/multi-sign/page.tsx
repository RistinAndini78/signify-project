'use client';

import { useState } from 'react';

interface Signed {
  file: string; bytes: number; docId: string; signers: number;
  publicKeys: { name: string; fp: string; pem: string }[];
  qr: {
    png: string; text: string; version: number; modules: number;
    codes: { png: string; text: string; version: number; modules: number; bytes: number; signer: { name: string; title: string; org: string; time: string; fp: string } }[];
  };
}
interface MultiVerification { valid: boolean; message: string; signers: { index: number; name: string; title: string; org: string; fp: string; hashOk: boolean; sigOk: boolean; qrOk: boolean; externalKeyMatches: boolean | null; valid: boolean; registeredAs: string | null }[] }
interface SignerRow { name: string; title: string; org: string; fp: string }
interface StagedSigner extends SignerRow { dskFile: File; passphrase: string }

const fromB64 = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

function download(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}

function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/x-pem-file' }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}

export default function MultiSignPage() {
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [keyMode, setKeyMode] = useState<'create' | 'upload'>('create');
  const [dskFile, setDskFile] = useState<File | null>(null);
  const [dskInputKey, setDskInputKey] = useState(0);
  const [passphrase, setPassphrase] = useState('');
  const [passphraseConfirm, setPassphraseConfirm] = useState('');
  const [identity, setIdentity] = useState({ name: '', title: '', org: '' });
  const [rows, setRows] = useState<SignerRow[]>([]);
  const [staged, setStaged] = useState<StagedSigner[]>([]);
  const [signed, setSigned] = useState<Signed | null>(null);
  const [verification, setVerification] = useState<MultiVerification | null>(null);
  const [verificationError, setVerificationError] = useState('');
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
    setVerification(null);
    setVerificationError('');
    setRows([]);
    setStaged([]);
    setKeyMode('create');
    setDskFile(null);
    setDskInputKey((key) => key + 1);
    setPassphrase('');
    setPassphraseConfirm('');
    setIdentity({ name: '', title: '', org: '' });
  }

  function startNewChain() {
    setCurrentFile(null);
    setSigned(null);
    setVerification(null);
    setVerificationError('');
    setRows([]);
    setStaged([]);
    setKeyMode('create');
    setDskFile(null);
    setDskInputKey((key) => key + 1);
    setPassphrase('');
    setPassphraseConfirm('');
    setIdentity({ name: '', title: '', org: '' });
    setError('');
  }

  async function addSigner() {
    setError('');
    if (!currentFile || signed) {
      setError('Pilih PDF asli untuk memulai rantai baru.');
      return;
    }
    if (!identity.name.trim() || !identity.title.trim() || !identity.org.trim()) {
      setError('Lengkapi nama, jabatan, dan institusi signer.');
      return;
    }
    if (keyMode === 'create' && passphrase.length < 8) {
      setError('Passphrase kunci minimal 8 karakter.');
      return;
    }
    if (keyMode === 'create' && passphrase !== passphraseConfirm) {
      setError('Konfirmasi passphrase belum sama.');
      return;
    }
    if (keyMode === 'upload' && (!dskFile || !passphrase)) {
      setError('Pilih file .dsk dan masukkan passphrase-nya.');
      return;
    }
    if (rows.length >= 12) {
      setError('Batas maksimum adalah 12 signer dalam satu dokumen.');
      return;
    }
    if (keyMode === 'upload' && !dskFile?.name.toLowerCase().endsWith('.dsk')) {
      setError('File kunci harus berformat .dsk.');
      return;
    }
    setBusy(true);
    try {
      let signerFile = dskFile;
      if (keyMode === 'create') {
        const response = await fetch('/api/keys/export', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passphrase }),
        });
        const generated = await response.json() as { keyFile?: unknown; fp?: unknown; error?: string };
        if (!response.ok) throw new Error(generated.error ?? 'Pembuatan kunci gagal.');
        if (typeof generated.keyFile !== 'string' || typeof generated.fp !== 'string') throw new Error('Respons pembuatan kunci tidak valid.');
        signerFile = new File([generated.keyFile], `signify-${generated.fp}.dsk`, { type: 'application/json' });
      }
      if (!signerFile) throw new Error('File kunci tidak tersedia.');
      const portable = JSON.parse(await signerFile.text()) as { fp?: unknown };
      if (typeof portable.fp !== 'string' || !/^[0-9a-f]{16}$/.test(portable.fp)) throw new Error('File .dsk tidak memiliki sidik jari yang valid.');
      if (rows.some((row) => row.fp === portable.fp)) throw new Error('Kunci ini sudah dipilih untuk signer lain. Gunakan kunci berbeda.');
      const signer = { ...identity, name: identity.name.trim(), title: identity.title.trim(), org: identity.org.trim(), fp: portable.fp, dskFile: signerFile, passphrase };
      setStaged((current) => [...current, signer]);
      setRows((current) => [...current, { name: signer.name, title: signer.title, org: signer.org, fp: signer.fp }]);
      setDskFile(null);
      setDskInputKey((key) => key + 1);
      setPassphrase('');
      setPassphraseConfirm('');
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
      setPassphraseConfirm('');
      setIdentity({ name: '', title: '', org: '' });
      try {
        const verificationForm = new FormData();
        verificationForm.set('file', new File([fromB64(data.file)], 'multi-sign.signed.pdf', { type: 'application/pdf' }));
        verificationForm.set('pubkeys', JSON.stringify(data.publicKeys.map((key) => key.pem)));
        const verificationResponse = await fetch('/api/verify', { method: 'POST', body: verificationForm });
        const verificationData = await verificationResponse.json() as MultiVerification & { error?: string };
        if (!verificationResponse.ok) throw new Error(verificationData.error ?? 'Verifikasi otomatis gagal.');
        setVerification(verificationData);
      } catch (cause) {
        setVerificationError(cause instanceof Error ? cause.message : 'Verifikasi otomatis gagal.');
      }
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
          <p className="eyebrow">Signify</p>
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
              <div className="key-mode-switch" role="group" aria-label="Cara menyiapkan kunci signer">
                <button type="button" className={keyMode === 'create' ? '' : 'button-secondary'} aria-pressed={keyMode === 'create'} onClick={() => { setKeyMode('create'); setDskFile(null); setPassphrase(''); setPassphraseConfirm(''); }}>Buat kunci baru</button>
                <button type="button" className={keyMode === 'upload' ? '' : 'button-secondary'} aria-pressed={keyMode === 'upload'} onClick={() => { setKeyMode('upload'); setDskFile(null); setDskInputKey((key) => key + 1); setPassphrase(''); setPassphraseConfirm(''); }}>Pakai file .dsk</button>
              </div>
              {keyMode === 'upload' && <div className="full-field"><label htmlFor={`multi-dsk-${dskInputKey}`}>File kunci privat (.dsk)</label><input key={dskInputKey} id={`multi-dsk-${dskInputKey}`} type="file" accept=".dsk,application/json" onChange={(event) => setDskFile(event.target.files?.[0] ?? null)} /></div>}
              <div className="field"><label htmlFor="multi-pass">{keyMode === 'create' ? 'Passphrase kunci baru' : 'Passphrase file .dsk'}</label><input id="multi-pass" type="password" autoComplete={keyMode === 'create' ? 'new-password' : 'current-password'} placeholder={keyMode === 'create' ? 'Minimal 8 karakter' : 'Passphrase untuk file .dsk'} value={passphrase} onChange={(event) => setPassphrase(event.target.value)} /></div>
              {keyMode === 'create' && <div className="field"><label htmlFor="multi-pass-confirm">Ulangi passphrase</label><input id="multi-pass-confirm" type="password" autoComplete="new-password" placeholder="Ulangi passphrase kunci" value={passphraseConfirm} onChange={(event) => setPassphraseConfirm(event.target.value)} /></div>}
              <div className="field"><label htmlFor="multi-name">Nama</label><input id="multi-name" placeholder="Nama lengkap signer" value={identity.name} onChange={(event) => setIdentity({ ...identity, name: event.target.value })} /></div>
              <div className="field"><label htmlFor="multi-title">Jabatan</label><input id="multi-title" placeholder="Jabatan signer" value={identity.title} onChange={(event) => setIdentity({ ...identity, title: event.target.value })} /></div>
              <div className="field"><label htmlFor="multi-org">Institusi</label><input id="multi-org" placeholder="Nama institusi" value={identity.org} onChange={(event) => setIdentity({ ...identity, org: event.target.value })} /></div>
              <div className="multi-sign-actions">
                <button onClick={addSigner} disabled={busy}>{busy ? 'Menyiapkan signer...' : keyMode === 'create' ? `Buat kunci & tambah signer ${signerNumber}` : `Tambah signer ${signerNumber}`}</button>
                {staged.length >= 2 && <button className="button-secondary" onClick={finalizeSignatures} disabled={busy}>{busy ? 'Membuat PDF final...' : `Finalisasi ${staged.length} signer`}</button>}
              </div>
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

        {signed && <>
          <section className="workflow-card multi-result"><div><p className="card-kicker"><span className="card-number">3</span> Hasil final</p><h2>{signed.signers} penandatangan tersimpan</h2><p className="card-intro">PDF final memuat satu QR-Code untuk setiap signer dan seluruh signature berantai.</p><button onClick={() => download(downloadName, fromB64(signed.file))}>Unduh PDF bertanda tangan</button></div><div className="qr-pair">{signed.qr.codes.map((code, index) => {
            const publicKey = signed.publicKeys.find((key) => key.fp === code.signer.fp);
            return <div key={`${code.signer.fp}-${index}`}><img className="qr-image" alt={`QR-Code signer ${index + 1}: ${code.signer.name}`} src={`data:image/png;base64,${code.png}`} /><small>{index + 1}. {code.signer.name}</small>{publicKey && <button type="button" className="button-secondary pem-download" onClick={() => downloadText(`signify-${publicKey.fp}-public.pem`, publicKey.pem)}>Unduh .pem</button>}</div>;
          })}</div></section>
          <section className="workflow-card multi-verification">
            <p className="card-kicker"><span className="card-number">4</span> Verifikasi Multi-sign</p>
            <h2>{verification ? verification.valid ? 'Semua signature valid' : 'Ada signature tidak valid' : 'Memeriksa signature...'}</h2>
            {verification && <p className={`notice ${verification.valid ? 'success' : 'error'}`}>{verification.message}</p>}
            {verificationError && <p className="error" role="alert">{verificationError}</p>}
            {verification && <ol className="verification-signer-list">{verification.signers.map((signer) => <li key={`${signer.fp}-${signer.index}`}>
              <div className="verification-signer-heading"><b>{signer.index}. {signer.name}</b><strong className={signer.valid ? 'verification-pass' : 'verification-fail'}>{signer.valid ? 'SAH' : 'TIDAK SAH'}</strong></div>
              <small>{signer.title} · {signer.org}</small>
              <div className="verification-checks"><span>Hash {signer.hashOk ? 'cocok' : 'gagal'}</span><span>Signature {signer.sigOk ? 'valid' : 'gagal'}</span><span>QR {signer.qrOk ? 'valid' : 'gagal'}</span><span>.pem {signer.externalKeyMatches ? 'cocok' : 'tidak cocok'}</span></div>
              <code>{signer.fp}</code>
            </li>)}</ol>}
          </section>
        </>}
        <p className="footer-note">ECDSA P-256 · SHA-256 · QR verification</p>
      </div>
    </main>
  );
}
