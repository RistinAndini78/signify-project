// Renders the report figures (SVG) from data-uji/hasil/hasil.json. Run `npm run bench` first.
// Usage: npm run charts   -> laporan/gambar/*.svg
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const data = JSON.parse(readFileSync(join(root, 'data-uji', 'hasil', 'hasil.json'), 'utf8'));
const out = join(root, 'laporan', 'gambar');
mkdirSync(out, { recursive: true });

const COLORS = ['#1f77b4', '#d62728', '#2ca02c', '#ff7f0e', '#9467bd'];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const num = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(3));

interface Series { name: string; values: number[] }

/** Grouped vertical bar chart. */
function bars(title: string, yLabel: string, groups: string[], series: Series[], file: string) {
  const W = 760, H = 420, L = 70, R = 20, T = 50, B = 90;
  const max = Math.max(...series.flatMap((s) => s.values)) * 1.12 || 1;
  const gw = (W - L - R) / groups.length, bw = Math.min(46, (gw * 0.8) / series.length);
  let g = '';
  for (let i = 0; i <= 5; i++) {
    const y = T + (H - T - B) * (1 - i / 5);
    g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="#ddd"/><text x="${L - 6}" y="${y + 4}" text-anchor="end" font-size="11">${num((max * i) / 5)}</text>`;
  }
  groups.forEach((name, gi) => {
    const x0 = L + gi * gw + (gw - bw * series.length) / 2;
    series.forEach((s, si) => {
      if (Number.isNaN(s.values[gi])) return; // no bar (for example: CBC has no tag)
      const h = ((H - T - B) * s.values[gi]) / max, x = x0 + si * bw, y = H - B - h;
      g += `<rect x="${x}" y="${y}" width="${bw - 3}" height="${h}" fill="${COLORS[si]}"/><text x="${x + (bw - 3) / 2}" y="${y - 4}" text-anchor="middle" font-size="10">${num(s.values[gi])}</text>`;
    });
    g += `<text x="${L + gi * gw + gw / 2}" y="${H - B + 16}" text-anchor="middle" font-size="${groups.length > 6 ? 8 : 11}">${esc(name)}</text>`;
  });
  const legend = series.map((s, i) => `<rect x="${L + i * 200}" y="${H - 28}" width="12" height="12" fill="${COLORS[i]}"/><text x="${L + i * 200 + 18}" y="${H - 18}" font-size="12">${esc(s.name)}</text>`).join('');
  svg(file, W, H, `<text x="${W / 2}" y="24" text-anchor="middle" font-size="15" font-weight="bold">${esc(title)}</text>
<text transform="translate(16 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle" font-size="12">${esc(yLabel)}</text>${g}${legend}`);
}

/** Byte histogram as thin bars. */
function histogram(title: string, series: Series[], file: string) {
  const W = 760, H = 440, L = 60, R = 20, T = 40, B = 50;
  const g = series.map((s, si) => {
    const max = Math.max(...s.values) * 1.08 || 1, ph = (H - T - B) / series.length - 30, y0 = T + 18 + si * (ph + 48);
    const bw = (W - L - R) / 256;
    const rects = s.values.map((v, i) => `<rect x="${L + i * bw}" y="${y0 + ph - (ph * v) / max}" width="${Math.max(bw - 0.3, 0.5)}" height="${(ph * v) / max}" fill="${COLORS[si]}"/>`).join('');
    return `${rects}<text x="${L + 4}" y="${y0 + 12}" font-size="12" font-weight="bold">${esc(s.name)} (maks ${max.toFixed(0)})</text><line x1="${L}" x2="${W - R}" y1="${y0 + ph}" y2="${y0 + ph}" stroke="#888"/>`;
  }).join('');
  svg(file, W, H, `<text x="${W / 2}" y="22" text-anchor="middle" font-size="15" font-weight="bold">${esc(title)}</text>${g}
<text x="${W / 2}" y="${H - 8}" text-anchor="middle" font-size="12">Nilai byte (0-255)</text>`);
}

function svg(file: string, w: number, h: number, body: string) {
  writeFileSync(join(out, file), `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Arial, sans-serif"><rect width="100%" height="100%" fill="white"/>${body}</svg>\n`);
  console.log('written - charts.ts:56', file);
}

type Row = (string | number)[];
const short = (n: string) => n.replace(/^sintetis-/, '').replace(/\.png$/, '');

/** Line chart, x = categories, y = values (0..1 or free). */
function lines(title: string, yLabel: string, xs: string[], series: Series[], file: string, yMax?: number) {
  const W = 760, H = 420, L = 70, R = 20, T = 50, B = 90;
  const max = yMax ?? (Math.max(...series.flatMap((s) => s.values)) * 1.1 || 1);
  const px = (i: number) => L + ((W - L - R) * i) / Math.max(1, xs.length - 1);
  const py = (v: number) => H - B - ((H - T - B) * v) / max;
  let g = '';
  for (let i = 0; i <= 5; i++) {
    const y = T + (H - T - B) * (1 - i / 5);
    g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="#ddd"/><text x="${L - 6}" y="${y + 4}" text-anchor="end" font-size="11">${num((max * i) / 5)}</text>`;
  }
  xs.forEach((x, i) => { g += `<text x="${px(i)}" y="${H - B + 16}" text-anchor="middle" font-size="11">${esc(x)}</text>`; });
  series.forEach((s, si) => {
    g += `<polyline fill="none" stroke="${COLORS[si % 5]}" stroke-width="2" points="${s.values.map((v, i) => `${px(i)},${py(v)}`).join(' ')}"/>`;
    if (xs.length <= 12) s.values.forEach((v, i) => { g += `<circle cx="${px(i)}" cy="${py(v)}" r="3" fill="${COLORS[si % 5]}"/>`; });
  });
  const legend = series.map((s, i) => `<rect x="${L + (i % 3) * 210}" y="${H - 36 + Math.floor(i / 3) * 16}" width="12" height="12" fill="${COLORS[i % 5]}"/><text x="${L + (i % 3) * 210 + 18}" y="${H - 26 + Math.floor(i / 3) * 16}" font-size="12">${esc(s.name)}</text>`).join('');
  svg(file, W, H, `<text x="${W / 2}" y="24" text-anchor="middle" font-size="15" font-weight="bold">${esc(title)}</text>
<text transform="translate(16 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle" font-size="12">${esc(yLabel)}</text>${g}${legend}`);
}

const t = data.timing as { hashRows: Row[]; pdfRows: Row[]; sigOnly: { mean: number }; verOnly: { mean: number } };
const labels = t.hashRows.map((r) => String(r[0]));
lines('Waktu vs ukuran berkas (non-PDF)', 'ms', labels, [
  { name: 'SHA-256 saja', values: t.hashRows.map((r) => Number(r[1])) },
  { name: 'Sign lengkap', values: t.hashRows.map((r) => Number(r[2])) },
  { name: 'Verify lengkap', values: t.hashRows.map((r) => Number(r[4])) },
], 'waktu-ukuran.svg');
bars('Waktu sign dan verify dokumen PDF (rerata 30 ulangan)', 'ms', t.pdfRows.map((r) => String(r[0]).replace(/ \(.*\)/, '')), [
  { name: 'Sign lengkap', values: t.pdfRows.map((r) => Number(r[1])) },
  { name: 'Verify', values: t.pdfRows.map((r) => Number(r[3])) },
], 'waktu-pdf.svg');

const sizes = data.sizes as Row[];
const pick = (label: string) => Number(sizes.find((r) => String(r[0]).startsWith(label))![1]);
bars('Ukuran objek (byte)', 'byte', ['Tanda tangan (r||s)', 'Tanda tangan (DER)', 'Kunci publik', 'Payload QR', 'Blok tanda tangan'],
  [{ name: 'byte', values: [pick('Tanda tangan ECDSA'), pick('Tanda tangan format DER'), pick('Kunci publik, titik'), pick('Payload QR'), pick('Blok tanda tangan')] }], 'ukuran.svg');

const multi = data.multi as Row[];
lines('Beberapa penandatangan: waktu verifikasi', 'ms', multi.map((r) => `${r[0]} orang`), [{ name: 'verify', values: multi.map((r) => Number(r[3])) }], 'multi-waktu.svg');
lines('Beberapa penandatangan: tambahan ukuran berkas', 'byte', multi.map((r) => `${r[0]} orang`), [{ name: 'tambahan', values: multi.map((r) => Number(r[2])) }], 'multi-ukuran.svg');
