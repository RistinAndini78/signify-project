'use client';

import { useEffect, useState } from 'react';

interface Key { id: string; name: string; title: string; org: string; created: string; fp: string; publicKey: string }
interface Signer { index: number; name: string; title: string; org: string; time: string; fp: string; hashOk: boolean; sigOk: boolean; qrOk: boolean; keyMatches: boolean; valid: boolean; registeredAs: string | null; reason: string }
interface Report {
  valid: boolean; blocks: number; message: string; signers: Signer[];
  qr: { ok: boolean; reason: string; meta?: { name: string; title: string; org: string; time: string }; registeredAs?: string | null } | null;
}
interface Signed { file: string; bytes: number; docId: string; signers: number; qr: { png: string; text: string; modules: number; version: number; bytes: number } }

const bytesOf = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const ok = (v: boolean) => (v ? '✓' : '✗');

function save(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const [keys, setKeys] = useState<Key[]>([]);
  const [form, setForm] = useState({ name: '', title: '', org: '', passphrase: '' });
  const [keyMsg, setKeyMsg] = useState('');

  const [keyId, setKeyId] = useState('');
  const [pass, setPass] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [signed, setSigned] = useState<Signed | null>(null);
  const [signErr, setSignErr] = useState('');

  const [vFile, setVFile] = useState<File | null>(null);
  const [qr, setQr] = useState('');
  const [pubMode, setPubMode] = useState<'auto' | 'vault' | 'paste'>('auto');
  const [vaultKey, setVaultKey] = useState('');
  const [pem, setPem] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [vErr, setVErr] = useState('');

  const loadKeys = async () => {
    const j = await (await fetch('/api/keys')).json();
    setKeys(j.keys ?? []);
    if (j.keys?.length && !keyId) { setKeyId(j.keys[0].id); setVaultKey(j.keys[0].id); }
  };
  useEffect(() => {
    void loadKeys();
    const h = window.location.hash;
    if (h.includes('q=')) setQr(h); // a scanned QR-Code opens this page with the payload in the fragment
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createKey() {
    setKeyMsg('');
    const r = await fetch('/api/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    const j = await r.json();
    if (r.ok) { setKeyMsg(`Kunci dibuat: ${j.name}, sidik jari ${j.fp}`); setForm({ ...form, passphrase: '' }); setKeyId(j.id); await loadKeys(); } else setKeyMsg(j.error ?? 'gagal');
  }

  async function sign() {
    setSignErr(''); setSigned(null);
    if (!file || !keyId) { setSignErr('Pilih kunci dan berkas'); return; }
    if (!file.name.toLowerCase().endsWith('.pdf')) { setSignErr('Hanya file PDF yang dapat ditandatangani.'); return; }
    const f = new FormData(); f.set('keyId', keyId); f.set('passphrase', pass); f.set('file', file);
    const r = await fetch('/api/sign', { method: 'POST', body: f });
    const j = await r.json();
    if (r.ok) setSigned(j); else setSignErr(j.error ?? 'gagal');
  }

  async function verify() {
    setVErr(''); setReport(null);
    if (vFile && !vFile.name.toLowerCase().endsWith('.pdf')) { setVErr('Hanya file PDF yang dapat diverifikasi.'); return; }
    const f = new FormData();
    if (vFile) f.set('file', vFile);
    if (qr) f.set('qr', qr);
    if (pubMode === 'vault' && vaultKey) f.set('keyId', vaultKey);
    if (pubMode === 'paste' && pem) f.set('pubkey', pem);
    const r = await fetch('/api/verify', { method: 'POST', body: f });
    const j = await r.json();
    if (r.ok) setReport(j); else setVErr(j.error ?? 'gagal');
  }

  const signedName = file ? file.name.replace(/(\.[^.]+)?$/, (m) => `.signed${m}`) : 'signed';

  return (
    <main className="app-shell">
      <div className="app-container">
        <header className="hero">
          <p className="eyebrow">Siliwangi-Disign</p>
          <h1>Tanda tangan yang bisa diverifikasi.</h1>
          <p className="hero-copy">Lindungi dokumen dengan ECDSA P-256, hash SHA-256, dan QR-Code yang membawa identitas penandatangan. Satu ruang kerja untuk membuat kunci, menandatangani, dan memeriksa keaslian.</p>
          <div className="hero-links"><a className="hero-link" href="/multi-sign">Buka Multi-signature</a><a className="hero-link" href="/uji-ketahanan">Uji Ketahanan Dokumen</a></div>
        </header>

        <div className="workflow-grid">
          <section className="workflow-card wide">
            <p className="card-kicker"><span className="card-number">1</span> Identitas kriptografis</p>
            <h2>Kunci penandatangan</h2>
            <p className="card-intro">Buat pasangan kunci baru. Kunci privat disimpan terenkripsi di server dan tidak pernah ditampilkan.</p>
            <div className="field-grid">
              <div className="field"><label htmlFor="name">Nama</label><input id="name" placeholder="Nama penandatangan" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="field"><label htmlFor="title">Jabatan</label><input id="title" placeholder="Contoh: Dosen" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
              <div className="field"><label htmlFor="org">Institusi</label><input id="org" placeholder="Nama institusi" value={form.org} onChange={(e) => setForm({ ...form, org: e.target.value })} /></div>
              <div className="field"><label htmlFor="passphrase">Kata sandi kunci</label><input id="passphrase" placeholder="Minimal 10 karakter" type="password" value={form.passphrase} onChange={(e) => setForm({ ...form, passphrase: e.target.value })} /></div>
            </div>
            <button onClick={createKey}>Buat pasangan kunci</button>
            {keyMsg && <p className="success">{keyMsg}</p>}
            <p className="notice">AES-256-GCM dan scrypt digunakan untuk melindungi kunci privat. Yang tampil di halaman ini hanya kunci publik dan sidik jarinya.</p>
            {keys.length > 0 && <div className="key-list"><table><thead><tr><th>Nama</th><th>Jabatan</th><th>Institusi</th><th>Sidik jari</th></tr></thead><tbody>
              {keys.map((k) => <tr key={k.id}><td>{k.name}</td><td>{k.title}</td><td>{k.org}</td><td><code>{k.fp}</code></td></tr>)}
            </tbody></table></div>}
          </section>

          <section className="workflow-card">
            <p className="card-kicker"><span className="card-number">2</span> Keaslian file</p>
            <h2>Tanda tangani</h2>
            <p className="card-intro">Pilih kunci dan berkas. Untuk tanda tangan berlapis, gunakan tombol tambah penandatangan setelah tahap pertama selesai.</p>
            <div className="field"><label htmlFor="sign-key">Kunci</label><select id="sign-key" value={keyId} onChange={(e) => setKeyId(e.target.value)}>
              {keys.map((k) => <option key={k.id} value={k.id}>{k.name} ({k.fp})</option>)}
            </select></div>
            <div className="field"><label htmlFor="sign-pass">Kata sandi kunci</label><input id="sign-pass" placeholder="Masukkan kata sandi" type="password" value={pass} onChange={(e) => setPass(e.target.value)} /></div>
            <div className="full-field"><label htmlFor="sign-file">Berkas PDF yang akan ditandatangani</label><input id="sign-file" type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
            <button onClick={sign}>Tanda tangani berkas</button>
            {signErr && <p className="error" role="alert">{signErr}</p>}
            {signed && <div className="success result-layout"><img className="qr-image" alt="QR-Code" src={`data:image/png;base64,${signed.qr.png}`} /><div className="result-copy"><b>Dokumen siap diunduh</b><p>{signed.signers} penandatangan · {signed.bytes} B</p><p className="mono">ID: {signed.docId}</p><div className="result-actions"><button onClick={() => save(signedName, bytesOf(signed.file))}>Unduh {signedName}</button></div><p><small>QR versi {signed.qr.version}, {signed.qr.modules}x{signed.qr.modules} modul. <span className="mono">{signed.qr.text.slice(0, 80)}...</span></small></p></div></div>}
          </section>

          <section className="workflow-card">
            <p className="card-kicker"><span className="card-number">3</span> Pemeriksaan</p>
            <h2>Verifikasi</h2>
            <p className="card-intro">Periksa dokumen bertanda tangan dan cocokkan QR dengan kunci publiknya.</p>
            <div className="full-field"><label htmlFor="verify-file">Berkas PDF bertanda tangan</label><input id="verify-file" type="file" accept="application/pdf,.pdf" onChange={(e) => setVFile(e.target.files?.[0] ?? null)} /></div>
            <div className="full-field"><label htmlFor="qr">Isi QR-Code</label><textarea id="qr" placeholder="Tautan atau payload QR akan terisi otomatis saat dibuka dari hasil pindaian." value={qr} onChange={(e) => setQr(e.target.value)} /></div>
            <div className="field"><label htmlFor="pub-mode">Sumber kunci publik</label><select id="pub-mode" value={pubMode} onChange={(e) => setPubMode(e.target.value as 'auto' | 'vault' | 'paste')}>
              <option value="auto">Otomatis dari berkas</option><option value="vault">Kunci terdaftar</option><option value="paste">Tempel PEM / raw</option>
            </select></div>
            {pubMode === 'vault' && <div className="field"><label htmlFor="vault-key">Kunci terdaftar</label><select id="vault-key" value={vaultKey} onChange={(e) => setVaultKey(e.target.value)}>{keys.map((k) => <option key={k.id} value={k.id}>{k.name} ({k.fp})</option>)}</select></div>}
            {pubMode === 'paste' && <div className="full-field"><label htmlFor="pem">Kunci publik</label><textarea id="pem" className="mono" placeholder="-----BEGIN PUBLIC KEY----- ..." value={pem} onChange={(e) => setPem(e.target.value)} /></div>}
            <button onClick={verify}>Verifikasi dokumen</button>
            {vErr && <p className="error" role="alert">{vErr}</p>}
            {report && <div className={`notice ${report.valid ? 'success' : 'error'}`}><div className={`status ${report.valid ? 'good' : 'bad'}`}>{report.valid ? '✓ SAH' : '✗ TIDAK SAH'}</div><div>{report.message}</div>
              {report.signers.length > 0 && <div className="key-list"><table><thead><tr><th>#</th><th>Penandatangan</th><th>Waktu</th><th>Hash</th><th>Signature</th><th>QR</th><th>Terdaftar</th><th>Keterangan</th></tr></thead><tbody>
                {report.signers.map((s) => <tr key={s.index}><td>{s.index}</td><td>{s.name}, {s.title}, {s.org}</td><td>{s.time}</td><td>{ok(s.hashOk)}</td><td>{ok(s.sigOk)}</td><td>{ok(s.qrOk)}</td><td>{s.registeredAs ?? 'tidak'}</td><td>{s.reason}</td></tr>)}
              </tbody></table></div>}
              {report.qr && <p>QR-Code: <b>{report.qr.ok ? 'sah' : 'tidak sah'}</b>, {report.qr.reason}{report.qr.meta ? ` (${report.qr.meta.name}, ${report.qr.meta.title}, ${report.qr.meta.org}, ${report.qr.meta.time})` : ''}{report.qr.registeredAs ? `, kunci terdaftar: ${report.qr.registeredAs}` : ''}</p>}
            </div>}
          </section>
        </div>
        <p className="footer-note">ECDSA P-256 · SHA-256 · QR verification</p>
      </div>
    </main>
  );
}
