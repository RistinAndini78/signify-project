# Lampiran: Penggunaan Asisten AI

Asisten AI (Claude Code) dipakai untuk membantu belajar dan menulis kode, sesuai ketentuan tugas. Setiap anggota bertanggung jawab memahami dan dapat menjelaskan seluruh bagian di bawah.

| Bagian | Alat AI | Bentuk bantuan | Diverifikasi oleh |
|--------|---------|----------------|-------------------|
| Rancangan format tanda tangan (blok di akhir berkas, tanda tangan QR, rantai penandatangan) dan ADR-001 | Claude Code | Usulan rancangan dan alasan; keputusan oleh anggota | `<anggota>` |
| `src/lib/sig/keys.ts`, `keystore.ts`, `encoding.ts` (kunci, brankas, penyegelan kunci privat) | Claude Code | Menulis draf kode; primitif dari Node `crypto` | `<anggota>` |
| `src/lib/sig/format.ts`, `service.ts`, `qr.ts`, `pdfstamp.ts` | Claude Code | Menulis draf kode | `<anggota>` |
| Route API dan UI (`src/app/`) | Claude Code | Menulis draf kode | `<anggota>` |
| Uji unit (`tests/`), termasuk uji setiap byte | Claude Code | Menulis kasus uji | `<anggota>` |
| Skrip pengujian dan grafik (`scripts/`) | Claude Code | Menulis skrip | `<anggota>` |
| Review keamanan (THR-001) dan perbaikan | Claude Code | Menemukan 3 temuan lewat uji byte dan menulis perbaikan | `<anggota>` |
| Draf laporan (`laporan/laporan.md`) | Claude Code | Menyusun kerangka, tabel dari hasil uji, analisis awal | `<anggota>` |

Yang dikerjakan sendiri oleh anggota: `<pemilihan topik dan pengayaan, PDF demo asli, menjalankan pengujian di laptop demo, mencoba pindai QR dengan ponsel, memeriksa angka dan analisis, referensi lewat Mendeley, video demo, presentasi>`.
