import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export class StampError extends Error {}

export const isPdf = (b: Buffer): boolean => b.length > 8 && b.toString('latin1', 0, 5) === '%PDF-';

// The standard PDF fonts only cover WinAnsi; anything else is shown as "?" so drawing never throws.
const win = (s: string): string => s.replace(/[^\x20-\x7e\xa0-\xff]/g, '?');

export interface Stamp { qrPng: Buffer; title: string; lines: string[]; url: string }

/** Adds a last page with the QR-Code and the signer details. The original pages are untouched. */
export async function addQrPage(pdf: Buffer, s: Stamp): Promise<Buffer> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdf, { updateMetadata: false });
  } catch {
    throw new StampError('cannot read the PDF (damaged or password protected)');
  }
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const img = await doc.embedPng(s.qrPng);
  page.drawText(win(s.title), { x: 50, y: 780, size: 18, font: bold });
  let y = 750;
  for (const line of s.lines) { page.drawText(win(line), { x: 50, y, size: 11, font }); y -= 18; }
  const size = 220;
  page.drawImage(img, { x: 50, y: y - size - 10, width: size, height: size });
  page.drawText('Pindai QR-Code untuk verifikasi. Unggah berkas ini pada halaman verifikasi untuk memeriksa keutuhan dokumen.', { x: 50, y: y - size - 30, size: 9, font, color: rgb(0.3, 0.3, 0.3) });
  page.drawText(win(s.url.length > 90 ? `${s.url.slice(0, 87)}...` : s.url), { x: 50, y: y - size - 44, size: 7, font, color: rgb(0.4, 0.4, 0.4) });
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}
