import ExcelJS from 'exceljs';
import { json } from '../../../lib/http';

type Report = { category: string; name: string; result: string; detail: string };

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { generatedAt?: string; runs?: number; reports?: Report[] } | null;
  if (!body?.reports?.length) return json({ error: 'reports are required' }, 400);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Hasil Pengujian');
  sheet.addRow(['Hasil pengujian wajib']);
  sheet.addRow(['Dibuat', body.generatedAt ?? new Date().toISOString()]);
  sheet.addRow(['Jumlah percobaan timing', body.runs ?? 30]);
  sheet.addRow([]);
  sheet.addRow(['Kategori', 'Pengujian', 'Hasil', 'Keterangan']).font = { bold: true };
  for (const report of body.reports) sheet.addRow([report.category, report.name, report.result, report.detail]);
  sheet.columns.forEach((column) => { column.width = 30; });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(buffer as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="hasil-pengujian.xlsx"',
    },
  });
}
