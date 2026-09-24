# Data pengujian

Pengujian wajib topik D:
- [x] Waktu sign dan verify, rata-rata dari >= 30 percobaan
- [x] Ukuran tanda tangan dan kunci publik
- [x] Uji tamper: ubah 1 byte, verifikasi harus gagal
- [x] Uji kunci salah dan QR-Code palsu

Jalankan pengujian dari halaman `/uji-ketahanan` dengan PDF asli, kunci benar, dan kunci salah yang berbeda. Setelah selesai, unduh JSON dan XLSX dari tombol hasil, lalu simpan salinannya di `hasil/` untuk dikumpulkan bersama laporan.
Uji serangan hanya terhadap data milik sendiri.
