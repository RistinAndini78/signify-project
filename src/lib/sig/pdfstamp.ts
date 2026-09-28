import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export class StampError extends Error {}

export const isPdf = (b: Buffer): boolean => b.length > 8 && b.toString('latin1', 0, 5) === '%PDF-';

// The standard PDF fonts only cover WinAnsi; anything else is shown as "?" so drawing never throws.
const win = (s: string): string => s.replace(/[^\x20-\x7e\xa0-\xff]/g, '?');

export interface Stamp { qrPng: Buffer; title: string; lines: string[]; url: string; secondary?: { qrPng: Buffer; title: string; lines: string[] } }
export interface SignerStamp { qrPng: Buffer; name: string; title: string; org: string; time: string; fp: string }

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
  const secondary = s.secondary ? await doc.embedPng(s.secondary.qrPng) : null;
  page.drawText(win(s.title), { x: 50, y: 780, size: 18, font: bold });
  let y = 750;
  for (const line of s.lines) { page.drawText(win(line), { x: 50, y, size: 11, font }); y -= 18; }
  const size = s.secondary ? 170 : 220;
  page.drawImage(img, { x: 50, y: y - size - 10, width: size, height: size });
  if (secondary && s.secondary) {
    const secondaryStamp = s.secondary;
    const mini = 120;
    page.drawImage(secondary, { x: 300, y: y - mini - 10, width: mini, height: mini });
    page.drawText(win(secondaryStamp.title), { x: 300, y: y - mini - 26, size: 9, font: bold });
    let secondaryY = y - mini - 42;
    for (const line of secondaryStamp.lines) { page.drawText(win(line), { x: 300, y: secondaryY, size: 8, font }); secondaryY -= 13; }
  }
  page.drawText('Pindai QR-Code untuk verifikasi. Unggah berkas ini pada halaman verifikasi untuk memeriksa keutuhan dokumen.', { x: 50, y: y - size - 30, size: 9, font, color: rgb(0.3, 0.3, 0.3) });
  page.drawText(win(s.url.length > 90 ? `${s.url.slice(0, 87)}...` : s.url), { x: 50, y: y - size - 44, size: 7, font, color: rgb(0.4, 0.4, 0.4) });
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

/** Adds one or more QR pages, with up to four signers on each page. */
export async function addQrPages(pdf: Buffer, signers: SignerStamp[], docId: string): Promise<Buffer> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdf, { updateMetadata: false });
  } catch {
    throw new StampError('cannot read the PDF (damaged or password protected)');
  }
  if (signers.length === 0) throw new StampError('at least one signer QR is required');

  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const images = await Promise.all(signers.map((signer) => doc.embedPng(signer.qrPng)));
  const perPage = 4;
  const pageCount = Math.ceil(signers.length / perPage);
  const pageWidth = 595, pageHeight = 842, margin = 42;
  const cellWidth = (pageWidth - margin * 2) / 2;
  const rowTop = [718, 365];
  const qrSize = 128;

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const page = doc.addPage([pageWidth, pageHeight]);
    const first = pageIndex * perPage;
    const last = Math.min(first + perPage, signers.length);
    page.drawText('Halaman Pengesahan Tanda Tangan Digital', { x: margin, y: 790, size: 17, font: bold });
    page.drawText(`ID dokumen: ${docId} · QR signer ${first + 1}-${last} dari ${signers.length}`, { x: margin, y: 768, size: 9, font, color: rgb(0.35, 0.3, 0.3) });

    for (let signerIndex = first; signerIndex < last; signerIndex += 1) {
      const localIndex = signerIndex - first;
      const column = localIndex % 2;
      const row = Math.floor(localIndex / 2);
      const x = margin + column * cellWidth;
      const top = rowTop[row];
      const signer = signers[signerIndex];
      page.drawText(win(`Signer ${signerIndex + 1}: ${signer.name}`), { x: x + 8, y: top, size: 10, font: bold, maxWidth: cellWidth - 16 });
      page.drawImage(images[signerIndex], { x: x + (cellWidth - qrSize) / 2, y: top - qrSize - 12, width: qrSize, height: qrSize });
      const details = [
        `Jabatan: ${signer.title}`,
        `Institusi: ${signer.org}`,
        `Waktu: ${signer.time}`,
        `Sidik jari: ${signer.fp}`,
      ];
      let detailY = top - qrSize - 30;
      for (const line of details) {
        page.drawText(win(line), { x: x + 8, y: detailY, size: 8, font, maxWidth: cellWidth - 16 });
        detailY -= 13;
      }
    }

    page.drawText('Pindai QR milik signer terkait. Unggah dokumen ini pada halaman verifikasi untuk memeriksa signature.', { x: margin, y: 35, size: 8, font, color: rgb(0.35, 0.3, 0.3), maxWidth: pageWidth - margin * 2 });
  }
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}
