# Naskah Demo UTS: Topik D, Aplikasi Digital Signature

Format sesi: paparan 5 menit, demo 7 menit, hasil pengujian 3 menit, tanya jawab 5 menit. Setiap anggota harus menjawab minimal satu pertanyaan tentang kode dan konsep.

## Persiapan (sebelum sesi)

- [ ] `npm install`. Untuk memindai QR dengan ponsel: `PUBLIC_URL=http://<alamat-laptop>:3000 npm run dev` (ponsel dan laptop satu jaringan; izinkan port 3000 di firewall). Tanpa ponsel: QR dibaca lewat kolom "isi QR".
- [ ] Siapkan PDF demo (mis. surat keterangan) dan berkas cadangan `surat.pdf`.
- [ ] Buat **dua kunci** sebelum sesi: mis. "Dr. A, Dosen, UNSIL" dan "B, Kaprodi, UNSIL", kata sandi (min. 10 karakter) dicatat. Kunci tersimpan di `data/keystore/` (jangan di-commit).
- [ ] Siapkan cara mengubah satu byte berkas. PowerShell:
  `$b=[IO.File]::ReadAllBytes('surat.signed.pdf'); $b[40]=$b[40] -bxor 1; [IO.File]::WriteAllBytes('surat.rusak.pdf',$b)`
  (atau ubah satu karakter dengan editor heksadesimal).
- [ ] Buka `data-uji/hasil/hasil-pengujian.xlsx` dan `laporan/gambar/`.
- [ ] Video cadangan siap diputar.

## Paparan (5 menit)

1. **Masalah (1 mnt):** tanda tangan basah atau gambar mudah disalin dan tidak membuktikan isi belum diubah; tanda tangan digital mengikat penandatangan, isi, dan waktu.
2. **Algoritma dan alasan (2 mnt):** ECDSA P-256 dengan SHA-256: tanda tangan hanya 64 byte, kunci publik 65 byte, cocok untuk QR-Code. Pesan yang ditandatangani = hash SHA-256 berkas + id dokumen + sidik jari kunci + metadata (nama, jabatan, institusi, waktu). Kunci privat disimpan terenkripsi (AES-256-GCM, kunci dari kata sandi dengan scrypt).
3. **Arsitektur (2 mnt):** blok tanda tangan ditambahkan setelah berkas (`%KRIPTO-SIG-V1 ...`), sehingga verifikasi tidak butuh server. PDF mendapat halaman QR. QR berisi metadata **dan tanda tangannya sendiri**, dibuka lewat tautan; beberapa penandatangan = beberapa blok berantai (pengayaan).

## Demo langsung (7 menit)

Skenario wajib: tandatangani sebuah PDF, pindai QR-Code untuk verifikasi yang berhasil, ubah satu karakter isi lalu tunjukkan verifikasi gagal, dan uji dengan kunci publik yang salah.

1. **Kunci:** tunjukkan daftar kunci (nama, jabatan, institusi, sidik jari); kunci privat tidak tampil. *(45 dtk)*
2. **Tanda tangani:** pilih kunci Dr. A, kata sandi, unggah `surat.pdf`, klik Tanda tangani. Tunjukkan QR-Code, unduh `surat.signed.pdf`, buka PDF: halaman terakhir berisi QR dan keterangan. *(1,5 mnt)*
3. **Pindai QR:** dengan ponsel (halaman verifikasi terbuka dan kolom QR terisi otomatis) atau tempel isi QR. Bagian setelah `#` tidak dikirim ke server. *(1 mnt)*
4. **Verifikasi berhasil:** unggah `surat.signed.pdf` + QR: **SAH**; tabel menunjukkan hash ✓, tanda tangan ✓, QR di blok ✓, kunci terdaftar, dan QR sah. *(1 mnt)*
5. **Ubah satu karakter:** unggah `surat.rusak.pdf` (satu byte diubah): **TIDAK SAH**, "dokumen diubah setelah tanda tangan". *(1 mnt)*
6. **Kunci publik salah:** kembali ke berkas asli, pilih "Kunci terdaftar" = B: **TIDAK SAH**, "kunci publik tidak cocok" (dan QR juga gagal). *(1 mnt)*
7. **QR palsu:** ubah satu karakter pada isi QR (mis. di tengah) lalu verifikasi: QR **tidak sah**. *(45 dtk)*
8. **Pengayaan, penandatangan kedua:** tandatangani `surat.signed.pdf` dengan kunci B; verifikasi: 2 penandatangan sah. Ubah satu byte: keduanya batal. *(1 mnt, bila waktu cukup)*

## Hasil pengujian (3 menit)

- **Tamper:** 100% terdeteksi: 1.618 pembalikan bit pada isi dokumen dan 3.465 pada blok tanda tangan; ditambah pembalikan bit di **setiap** byte berkas 666 byte (uji unit).
- **Kunci salah:** 50 kunci acak, semua ditolak. Penipu dengan nama sama tetapi kunci sendiri: tanda tangan sah secara matematis, **kunci tidak terdaftar**.
- **QR palsu:** semua 11 skenario ditolak (setiap field diubah, 64 pembalikan bit pada tanda tangan QR, QR penandatangan lain, QR dokumen lain).
- **Waktu (≥ 30 ulangan):** ECDSA sign 0,022 ms, verify 0,054 ms; sign lengkap ±15 ms (14,8 ms adalah pembuatan QR); verify lengkap 0,18 ms (1 KB) sampai 5,3 ms (10 MB).
- **Ukuran:** tanda tangan 64 B (DER 71 B), kunci publik 65 B, blok 693 B, QR 320 B (versi 13, 69×69 modul).
- **Kunci privat:** enkripsi/buka ±50 ms (scrypt).
- **Beberapa penandatangan:** +680 B dan ±0,17 ms per penandatangan.

## Perkiraan pertanyaan dan jawaban

| Pertanyaan | Jawaban singkat |
|------------|-----------------|
| Mengapa ECDSA, bukan RSA? | Tanda tangan dan kunci kecil (64/65 B) sehingga QR tetap sederhana; keamanan ±128 bit; cepat. |
| Apa yang sebenarnya ditandatangani? | Hash SHA-256 byte sebelum blok, id dokumen, sidik jari, metadata, dan tanda tangan QR; mengubah salah satunya membatalkan tanda tangan. |
| Mengapa QR punya tanda tangan sendiri? | QR ada di dalam berkas yang ditandatangani, jadi tidak bisa memuat tanda tangan atas berkas itu; tanda tangan QR mengikat metadata ke pemilik kunci dan QR bisa diperiksa sendiri. |
| Apakah QR sah berarti dokumen sah? | Tidak: QR hanya membuktikan penandatangan dan id dokumen; keutuhan isi dari tanda tangan dokumen. Karena itu id QR harus cocok dengan berkas. |
| Bagaimana kunci privat dilindungi? | PKCS#8 dienkripsi AES-256-GCM, kunci dari kata sandi lewat scrypt, sidik jari sebagai AAD; tidak pernah di kode atau repo. |
| Bagaimana tahu penandatangan itu benar orangnya? | Dari sidik jari kunci yang terdaftar; tanpa sertifikat, identitas hanya sebaik daftar kunci (keterbatasan yang dicatat). |
| Bagaimana beberapa penandatangan bekerja? | Tiap blok menandatangani semua byte sebelumnya termasuk blok sebelumnya; menghapus yang terakhir menyisakan yang sebelumnya sah. |
| Mengapa blok setelah akhir PDF? | Menjaga byte tertanda tangan utuh; kelemahannya poppler memberi peringatan xref yang dapat diperbaiki mulai dua penandatangan. |

## Rencana cadangan

- Ponsel tidak terhubung: tempel isi QR (tombol Salin dari tautan yang ditampilkan) di kolom verifikasi.
- Aplikasi gagal jalan: putar video cadangan; gunakan hasil JSON/XLSX yang sebelumnya diunduh dari halaman `/uji-ketahanan`.
- Lupa kata sandi kunci: buat kunci baru (ID dokumen dan tanda tangan sebelumnya tetap sah untuk kunci lama).
- PDF tidak mau ditandatangani (terenkripsi/rusak): pakai `surat.pdf` cadangan atau berkas non-PDF.
