'use client';

import jsQR from 'jsqr';
import { useEffect, useRef, useState } from 'react';

interface Key { id: string; name: string; title: string; org: string; created: string; fp: string; publicKey: string }
interface Signer { index: number; name: string; title: string; org: string; time: string; fp: string; hashOk: boolean; sigOk: boolean; qrOk: boolean; keyMatches: boolean; externalKeyMatches: boolean | null; valid: boolean; registeredAs: string | null; reason: string }
interface Report {
  valid: boolean; blocks: number; message: string; signers: Signer[]; unmatchedPublicKeys: string[];
  qr: { ok: boolean; reason: string; meta?: { name: string; title: string; org: string; time: string }; registeredAs?: string | null } | null;
}
interface Signed { file: string; bytes: number; docId: string; signers: number; qr: { png: string; text: string; modules: number; version: number; bytes: number } }
interface GeneratedKey { keyFile: string; publicPem: string; fp: string }

const bytesOf = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const ok = (v: boolean) => (v ? '✓' : '✗');

function save(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}

function saveText(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const [keyPass, setKeyPass] = useState('');
  const [keyPassConfirm, setKeyPassConfirm] = useState('');
  const [generatedKey, setGeneratedKey] = useState<GeneratedKey | null>(null);
  const [keyMsg, setKeyMsg] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);

  const [pass, setPass] = useState('');
  const [dskFile, setDskFile] = useState<File | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [signed, setSigned] = useState<Signed | null>(null);
  const [signErr, setSignErr] = useState('');
  const [signBusy, setSignBusy] = useState(false);
  const [identity, setIdentity] = useState({ name: '', title: '', org: '' });

  const [vFile, setVFile] = useState<File | null>(null);
  const [qr, setQr] = useState('');
  const [pemFileContents, setPemFileContents] = useState<string[]>([]);
  const [pemFileNames, setPemFileNames] = useState<string[]>([]);
  const [pem, setPem] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [vErr, setVErr] = useState('');
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const h = window.location.hash;
    if (h.includes('q=')) setQr(h); // a scanned QR-Code opens this page with the payload in the fragment
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!cameraOn) return;
    let stream: MediaStream | null = null;
    let frame = 0;
    let cancelled = false;

    async function scanWithCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Kamera memerlukan koneksi HTTPS atau localhost dan dukungan browser.');
        setCameraOn(false);
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
        const video = videoRef.current;
        if (!video) throw new Error('Pratinjau kamera tidak tersedia.');
        video.srcObject = stream;
        await video.play();
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Pemindai QR tidak dapat dimulai.');
        let lastScan = 0;
        const scanFrame = (time: number) => {
          if (cancelled) return;
          if (time - lastScan >= 100 && video.readyState >= 2 && video.videoWidth > 0) {
            lastScan = time;
            const scale = Math.min(1, 960 / video.videoWidth);
            canvas.width = Math.round(video.videoWidth * scale);
            canvas.height = Math.round(video.videoHeight * scale);
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const image = context.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' });
            if (code?.data) {
              setQr(code.data);
              setCameraError('QR berhasil dipindai. Lanjutkan dengan verifikasi dokumen.');
              setCameraOn(false);
              return;
            }
          }
          frame = requestAnimationFrame(scanFrame);
        };
        frame = requestAnimationFrame(scanFrame);
      } catch (cause) {
        if (!cancelled) {
          const message = cause instanceof DOMException && cause.name === 'NotAllowedError'
            ? 'Akses kamera ditolak. Izinkan akses kamera pada pengaturan browser.'
            : 'Kamera tidak dapat dibuka. Pastikan kamera tidak sedang digunakan aplikasi lain.';
          setCameraError(message);
          setCameraOn(false);
        }
      }
    }

    void scanWithCamera();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [cameraOn]);

  async function createKey() {
    setKeyMsg(''); setGeneratedKey(null);
    if (keyPass.length < 8) { setKeyMsg('Passphrase harus terdiri dari minimal 8 karakter.'); return; }
    if (keyPass !== keyPassConfirm) { setKeyMsg('Konfirmasi passphrase belum sama.'); return; }
    setKeyBusy(true);
    try {
      const r = await fetch('/api/keys/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passphrase: keyPass }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Pembuatan kunci gagal.');
      setGeneratedKey(j);
      setKeyPass(''); setKeyPassConfirm('');
      setKeyMsg('Pasangan kunci berhasil dibuat. Unduh dan simpan kedua file berikut.');
    } catch (cause) {
      setKeyMsg(cause instanceof Error ? cause.message : 'Pembuatan kunci gagal.');
    } finally {
      setKeyBusy(false);
    }
  }

  async function sign() {
    setSignErr(''); setSigned(null);
    if (!file || !dskFile || !pass || !identity.name.trim() || !identity.title.trim() || !identity.org.trim()) { setSignErr('Lengkapi PDF, file .dsk, passphrase, nama, jabatan, dan institusi.'); return; }
    if (!file.name.toLowerCase().endsWith('.pdf')) { setSignErr('Hanya file PDF yang dapat ditandatangani.'); return; }
    if (!dskFile.name.toLowerCase().endsWith('.dsk')) { setSignErr('Pilih file kunci dengan ekstensi .dsk.'); return; }
    setSignBusy(true);
    const f = new FormData();
    f.set('dsk', dskFile); f.set('passphrase', pass); f.set('file', file);
    f.set('name', identity.name.trim()); f.set('title', identity.title.trim()); f.set('org', identity.org.trim());
    try {
      const r = await fetch('/api/sign', { method: 'POST', body: f });
      const j = await r.json();
      if (r.ok) setSigned(j); else setSignErr(j.error ?? 'Tanda tangan gagal.');
    } catch {
      setSignErr('Tidak dapat menghubungi server untuk menandatangani berkas.');
    } finally {
      setSignBusy(false);
    }
  }

  async function verify() {
    setVErr(''); setReport(null);
    if (!vFile) { setVErr('Pilih file PDF hasil tanda tangan terlebih dahulu.'); return; }
    if (!vFile.name.toLowerCase().endsWith('.pdf')) { setVErr('Hanya file PDF yang dapat diverifikasi.'); return; }
    const publicKeys = [...pemFileContents, ...(pem.trim() ? [pem.trim()] : [])];
    const f = new FormData();
    f.set('file', vFile);
    if (qr) f.set('qr', qr);
    f.set('pubkeys', JSON.stringify(publicKeys));
    setVerifyBusy(true);
    try {
      const r = await fetch('/api/verify', { method: 'POST', body: f });
      const j = await r.json();
      if (r.ok) setReport(j); else setVErr(j.error ?? 'Verifikasi gagal.');
    } catch {
      setVErr('Tidak dapat menghubungi server untuk memverifikasi berkas.');
    } finally {
      setVerifyBusy(false);
    }
  }

  async function readVerifyPemList(fileList: FileList | null) {
    setPemFileNames([]); setPemFileContents([]); setReport(null); setVErr('');
    const files = Array.from(fileList ?? []);
    if (files.length > 12) { setVErr('Pilih maksimal 12 file public key .pem.'); return; }
    if (files.some((file) => !file.name.toLowerCase().endsWith('.pem'))) { setVErr('Semua public key harus berformat .pem.'); return; }
    if (files.some((file) => file.size > 16 * 1024)) { setVErr('Setiap file public key maksimal 16 KB.'); return; }
    try {
      setPemFileContents(await Promise.all(files.map((file) => file.text())));
      setPemFileNames(files.map((file) => file.name));
    } catch {
      setVErr('File public key tidak dapat dibaca.');
    }
  }



  const signedName = file ? file.name.replace(/(\.[^.]+)?$/, (m) => `.signed${m}`) : 'signed';

        <div className="workflow-grid">
          <section className="workflow-card">
            <p className="card-kicker"><span className="card-number">1</span> Key Management</p>
            <h2>Buat Pasangan Kunci</h2>
            <p className="card-intro">Buat kunci ECDSA P-256 baru. Private key akan dienkripsi dengan passphrase dan diunduh sebagai file .dsk.</p>
            <div className="dotted-rule" />
            <div className="field"><label htmlFor="key-pass">PASSPHRASE (MINIMAL 8 KARAKTER)</label><input id="key-pass" type="password" autoComplete="new-password" placeholder="Masukkan passphrase" value={keyPass} onChange={(e) => setKeyPass(e.target.value)} /></div>
            <div className="field"><label htmlFor="key-pass-confirm">ULANGI PASSPHRASE</label><input id="key-pass-confirm" type="password" autoComplete="new-password" placeholder="Ulangi passphrase" value={keyPassConfirm} onChange={(e) => setKeyPassConfirm(e.target.value)} /></div>
            <button className="primary-wide" onClick={createKey} disabled={keyBusy}>{keyBusy ? 'Membuat kunci...' : 'Buat Pasangan Kunci'}</button>
            {keyMsg && <p className={generatedKey ? 'success' : 'error'} role={generatedKey ? 'status' : 'alert'}>{keyMsg}</p>}
            {generatedKey && <div className="key-downloads">
              <p className="key-fingerprint">Sidik jari · <code>{generatedKey.fp}</code></p>
              <button className="download-button" onClick={() => saveText(`signify-${generatedKey.fp}.dsk`, generatedKey.keyFile, 'application/json')}>Unduh private key (.dsk)</button>
              <button className="download-button button-secondary" onClick={() => saveText(`signify-${generatedKey.fp}-public.pem`, generatedKey.publicPem, 'application/x-pem-file')}>Unduh public key (.pem)</button>
            </div>}
          </section>

          <section className="workflow-card">
            <p className="card-kicker"><span className="card-number">2</span> Penandatanganan</p>
            <h2>Tandatangani PDF</h2>
            <p className="card-intro">Gunakan file .dsk dan identitas Anda untuk menandatangani dokumen.</p>
            <div className="dotted-rule" />
            <div className="full-field"><label htmlFor="sign-file">PDF</label><input id="sign-file" type="file" accept="application/pdf,.pdf" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setSigned(null); }} /></div>
            {file && <p className="selected-file">PDF: <b>{file.name}</b></p>}
            <div className="full-field"><label htmlFor="sign-dsk">PRIVATE KEY (.DSK)</label><input id="sign-dsk" type="file" accept=".dsk,application/json" onChange={(e) => { setDskFile(e.target.files?.[0] ?? null); setSigned(null); }} /></div>
            <div className="field"><label htmlFor="pass">PASSPHRASE</label><input id="pass" type="password" placeholder="Passphrase" value={pass} onChange={(e) => setPass(e.target.value)} /></div>
            <div className="field"><label htmlFor="name">NAMA</label><input id="name" placeholder="Nama" value={identity.name} onChange={(e) => setIdentity({ ...identity, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="title">JABATAN</label><input id="title" placeholder="Jabatan" value={identity.title} onChange={(e) => setIdentity({ ...identity, title: e.target.value })} /></div>
            <div className="field"><label htmlFor="org">INSTITUSI</label><input id="org" placeholder="Institusi" value={identity.org} onChange={(e) => setIdentity({ ...identity, org: e.target.value })} /></div>
            <button className="primary-wide" onClick={sign} disabled={signBusy}>{signBusy ? 'Memproses...' : 'Tandatangani Berkas'}</button>
            {signErr && <p className="error">{signErr}</p>}
            {signed && <div className="success"><b>Dokumen siap!</b><br /><button onClick={() => save(signedName, bytesOf(signed.file))}>Unduh PDF</button></div>}
          </section>
        </div>
  return (
    <main className="app-shell">
      <div className="app-container">
        <header className="hero">
          <p className="eyebrow">Signify · Tanda tangan digital</p>
          <h1>Buat pasangan kunci ECDSA P-256</h1>
          <p>Private key langsung dienkripsi AES-256-GCM dengan key yang diturunkan dari passphrase via scrypt, lalu diunduh sebagai file .dsk. Public key (SPKI/PEM) bebas dibagikan kepada siapa pun yang perlu memverifikasi tanda tangan Anda.</p>
          <nav className="hero-links"><a className="hero-link" href="/multi-sign">Multi-signature</a><a className="hero-link" href="/uji-ketahanan">Uji ketahanan</a></nav>
        </header>

        <div className="key-grid">
          <section className="paper-panel">
            <p className="card-kicker"><span className="card-number">1</span> buat Pasangan Kunci </p>
            <h2>Passphrase</h2>
            <p className="card-intro">Passphrase dikirim melalui HTTPS hanya untuk derivasi kunci AES. Passphrase tidak disimpan; private key terenkripsi diunduh sebagai file .dsk.</p>
            <div className="dotted-rule" />
            <div className="field"><label htmlFor="key-pass">PASSPHRASE (MINIMAL 8 KARAKTER)</label><input id="key-pass" type="password" autoComplete="new-password" placeholder="Masukkan passphrase" value={keyPass} onChange={(e) => setKeyPass(e.target.value)} /></div>
            <div className="field"><label htmlFor="key-pass-confirm">ULANGI PASSPHRASE</label><input id="key-pass-confirm" type="password" autoComplete="new-password" placeholder="Ulangi passphrase" value={keyPassConfirm} onChange={(e) => setKeyPassConfirm(e.target.value)} /></div>
            <button className="primary-wide" onClick={createKey} disabled={keyBusy}>{keyBusy ? 'Membuat kunci...' : 'Buat Pasangan Kunci'}</button>
            {keyMsg && <p className={generatedKey ? 'success' : 'error'} role={generatedKey ? 'status' : 'alert'}>{keyMsg}</p>}
          </section>
          <section className="paper-panel key-result-panel">
            <h2>Hasil</h2>
            <p className="card-intro">Simpan KEDUA file ini bersama-sama. File .dsk tidak dapat digunakan tanpa passphrase Anda.</p>
            <div className="dotted-rule" />
            {generatedKey ? <div className="key-downloads">
              <p className="key-fingerprint">Sidik jari · <code>{generatedKey.fp}</code></p>
              <button className="download-button" onClick={() => saveText(`signify-${generatedKey.fp}.dsk`, generatedKey.keyFile, 'application/json')}>Unduh private key (.dsk)</button>
              <button className="download-button button-secondary" onClick={() => saveText(`signify-${generatedKey.fp}-public.pem`, generatedKey.publicPem, 'application/x-pem-file')}>Unduh public key (.pem)</button>
              <p className="notice">Jangan bagikan file .dsk atau passphrase. Public key boleh dibagikan untuk verifikasi.</p>
            </div> : <p className="empty-key-result">Hasil generate akan muncul di sini, lengkap dengan tombol unduh public key dan private key terenkripsi.</p>}
          </section>
        </div>

        <section className="sign-workspace">

          <div className="section-heading">
          <div className="sign-grid">
            <section className="paper-panel sign-form-panel">
            <p className="card-kicker"><span className="card-number">2</span> Alur Penandatanganan</p>
            <h2>Tandatangani berkas PDF</h2><p>Gunakan file .dsk yang Anda simpan saat membuat pasangan kunci.</p>
              <div className="field"><label htmlFor="sign-file">1. BERKAS PDF</label><input id="sign-file" type="file" accept="application/pdf,.pdf" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setSigned(null); }} /></div>
              {file && <p className="selected-file">Berkas dipilih: <b>{file.name}</b></p>}
              <div className="field"><label htmlFor="sign-dsk">2. PRIVATE KEY (.DSK)</label><input id="sign-dsk" type="file" accept=".dsk,application/json" onChange={(e) => { setDskFile(e.target.files?.[0] ?? null); setSigned(null); }} /></div>
              <div className="field"><label htmlFor="sign-pass">3. PASSPHRASE</label><input id="sign-pass" placeholder="Masukkan passphrase kunci" type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} /></div>
              <div className="dotted-rule" />
              <div className="field"><label htmlFor="sign-name">NAMA PENANDATANGAN</label><input id="sign-name" placeholder="Nama lengkap" value={identity.name} onChange={(e) => setIdentity({ ...identity, name: e.target.value })} /></div>
              <div className="field"><label htmlFor="sign-title">JABATAN</label><input id="sign-title" placeholder="Contoh: Kepala Program Studi" value={identity.title} onChange={(e) => setIdentity({ ...identity, title: e.target.value })} /></div>
              <div className="field"><label htmlFor="sign-org">INSTITUSI</label><input id="sign-org" placeholder="Nama institusi" value={identity.org} onChange={(e) => setIdentity({ ...identity, org: e.target.value })} /></div>
              <button className="primary-wide" onClick={sign} disabled={signBusy}>{signBusy ? 'Menandatangani...' : 'Tandatangani Berkas'}</button>
              {signErr && <p className="error" role="alert">{signErr}</p>}
            </section>
          
            <section className="paper-panel sign-result-panel">
              <h2>Dokumen bertanda tangan</h2>
              <p className="card-intro">Hasil tanda tangan digital dan QR verifikasi akan tersedia di sini.</p>
              <div className="dotted-rule" />
              {signed ? <div className="result-copy">
                <p className="success"><b>Dokumen siap diunduh</b><br />{signed.signers} penandatangan · {signed.bytes.toLocaleString('id-ID')} byte</p>
                <p className="mono">ID dokumen: {signed.docId}</p>
                <img className="qr-image" alt="QR-Code verifikasi dokumen" src={`data:image/png;base64,${signed.qr.png}`} />
                <button className="download-button" onClick={() => save(signedName, bytesOf(signed.file))}>Unduh PDF bertanda tangan</button>
              </div> : <p className="empty-key-result">Lengkapi berkas dan identitas, lalu pilih tombol tandatangani berkas.</p>}
            </section>
            </div>
          </div>
        </section>

        <div className="workflow-grid">
          <section className="workflow-card wide">
            <p className="card-kicker"><span className="card-number">3</span> Verifikasi</p>
            <h2>Verifikasi Dokumen</h2>
            <p className="card-intro">Verifikasi semua signature dalam PDF, termasuk dokumen multi-sign. Public key di dalam signature block dipakai untuk pemeriksaan kriptografis; PEM eksternal opsional untuk mencocokkan identitas tiap signer.</p>
            <div className="full-field"><label htmlFor="verify-file">PDF BERTANDA TANGAN</label><input id="verify-file" type="file" accept="application/pdf,.pdf" onChange={(e) => { setVFile(e.target.files?.[0] ?? null); setReport(null); }} /></div>
            {vFile && <p className="selected-file">PDF: <b>{vFile.name}</b></p>}
            <div className="full-field"><label htmlFor="verify-pem-file">PUBLIC KEY (.PEM), OPSIONAL, MAKS. 12 FILE</label><input id="verify-pem-file" type="file" multiple accept=".pem,application/x-pem-file,text/plain" onChange={(e) => void readVerifyPemList(e.target.files)} />{pemFileNames.length > 0 && <small className="selected-file">File: <b>{pemFileNames.join(', ')}</b></small>}</div>
            <details className="optional-pem"><summary>Atau tempel satu public key sebagai teks</summary><div className="full-field"><label htmlFor="pem">PUBLIC KEY PEM / RAW</label><textarea id="pem" className="mono" placeholder="-----BEGIN PUBLIC KEY----- ..." value={pem} onChange={(e) => { setPem(e.target.value); setReport(null); }} /></div></details>
            <div className="dotted-rule" />
            <div className="scanner-heading">
              <div><b>QR VERIFIKASI</b><small>Opsional.</small></div>
              <button type="button" className="button-secondary" onClick={() => { setCameraError(''); setCameraOn(true); }} disabled={cameraOn}>Pindai Kamera</button>
            </div>
            {cameraOn && <div className="camera-scanner"><video ref={videoRef} autoPlay playsInline muted /><button type="button" className="button-secondary" onClick={() => setCameraOn(false)}>Hentikan</button></div>}
            {cameraError && <p className={cameraOn ? 'notice' : 'scanner-status'}>{cameraError}</p>}
            <button className="primary-wide" onClick={verify} disabled={verifyBusy}>{verifyBusy ? 'Memeriksa...' : 'Verifikasi dokumen'}</button>
            {vErr && <p className="error">{vErr}</p>}
            {report && <>
              <div className={`notice ${report.valid ? 'success' : 'error'}`}>{report.valid ? '✓ SAH' : '✗ TIDAK SAH'} - {report.message}</div>
              {report.unmatchedPublicKeys.length > 0 && <p className="error">{report.unmatchedPublicKeys.length} public key tidak cocok dengan signer mana pun dalam dokumen.</p>}
              {report.signers.length > 0 && <ol className="verification-signer-list">{report.signers.map((signer) => <li key={`${signer.fp}-${signer.index}`}>
                <div className="verification-signer-heading"><b>{signer.index}. {signer.name}</b><strong className={signer.valid ? 'verification-pass' : 'verification-fail'}>{signer.valid ? 'SAH' : 'TIDAK SAH'}</strong></div>
                <small>{signer.title} · {signer.org}</small>
                <div className="verification-checks"><span>Hash {signer.hashOk ? 'cocok' : 'gagal'}</span><span>Signature {signer.sigOk ? 'valid' : 'gagal'}</span><span>QR {signer.qrOk ? 'valid' : 'gagal'}</span><span>.pem {signer.externalKeyMatches === null ? 'tidak diunggah' : signer.externalKeyMatches ? 'cocok' : 'tidak cocok'}</span></div>
                <small>{signer.registeredAs ? `Terdaftar sebagai ${signer.registeredAs}` : 'Tidak terdaftar di vault lokal'}</small>
                <code>{signer.fp}</code>
              </li>)}</ol>}
            </>}
          </section>
        </div>
        <p className="footer-note">ECDSA P-256 · SHA-256 · QR verification</p>
      </div>
    </main>
  );
}
