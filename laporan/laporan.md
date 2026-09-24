# Aplikasi Tanda Tangan Digital ECDSA P-256 dengan QR-Code dan Beberapa Penandatangan

**Tugas Proyek Aplikasi Kriptografi, Keamanan Informasi, Informatika UNSIL** (Topik D)

| | |
|---|---|
| Anggota | Muamad Rizky Pratama, 247006111046 |
| Repositori | `<tautan GitHub>` |
| Video demo | `<tautan YouTube>` |
| Berkas kumpul | `TugasKripto_D_<NPM-Ketua>.pdf` |

> DRAF. Angka bab 5 berasal dari hasil XLSX yang diunduh dari halaman `/uji-ketahanan` (dijalankan 2026-09-24, Node 24, Windows 11). Waktu berbeda antar mesin dan antar jalan: jalankan kembali pengujian melalui tombol halaman pada laptop demo lalu perbarui tabel waktu. Uji tamper, kunci salah, dan QR palsu bersifat deterministik. Target akhir 6-12 halaman: ringkas bab 2 dan 4 bila melebihi.

## 1. Pendahuluan

**Latar belakang.** Surat keterangan, sertifikat kegiatan, dan lembar pengesahan laporan biasanya dicetak atau dikirim sebagai PDF. Tanda tangan basah atau gambar tanda tangan mudah disalin dan tidak membuktikan bahwa isi dokumen belum diubah. Tanda tangan digital mengikat penandatangan, isi dokumen, dan waktu penandatanganan secara kriptografis, dan QR-Code pada dokumen memudahkan orang memeriksanya.

**Masalah.** Bagaimana menandatangani dokumen sehingga (1) perubahan satu byte pun terdeteksi, (2) kunci publik yang salah dan QR-Code yang dipalsukan ditolak, (3) kunci privat tidak pernah tersimpan dalam bentuk terbuka, dan (4) beberapa orang dapat menandatangani dokumen yang sama?

**Tujuan.** Membangun aplikasi web tanda tangan digital dengan ECDSA P-256 atas hash SHA-256 berkas, QR-Code berisi metadata dan tanda tangan, brankas kunci terenkripsi, dan penandatanganan oleh beberapa orang; lalu mengukur waktu, ukuran, dan ketahanan terhadap tamper, kunci salah, dan QR palsu.

## 2. Dasar Teori

**Tanda tangan digital.** Penandatangan memiliki pasangan kunci. Tanda tangan dibuat dengan kunci privat atas pesan, diperiksa siapa pun dengan kunci publik. Keamanannya bertumpu pada kekuatan hash (SHA-256) dan sulitnya logaritma diskret pada kurva eliptik.

**ECDSA P-256.** Kurva NIST P-256 (`secp256r1`) memberi keamanan sekitar 128 bit dengan kunci 256 bit. Tanda tangan berupa dua bilangan `(r, s)`; bentuk mentah IEEE P1363 selalu 64 byte (bentuk DER 70 sampai 72 byte). ECDSA membutuhkan nilai acak per tanda tangan; pustaka yang dipakai (OpenSSL melalui Node `crypto`) membangkitkannya dengan aman.

**Hash.** SHA-256 menghasilkan 32 byte dari berkas berukuran berapa pun; mengubah satu bit berkas mengubah hash secara tak terduga.

**Perlindungan kunci privat.** Kunci privat (PKCS#8) dienkripsi dengan AES-256-GCM; kuncinya diturunkan dari kata sandi dengan scrypt (N = 2^15, r = 8, p = 1) dan salt acak. Sidik jari kunci publik menjadi data tambahan (AAD) agar berkas kunci tidak dapat ditukar.

**QR-Code.** Kode dua dimensi dengan koreksi kesalahan Reed-Solomon; level M memulihkan sekitar 15% modul yang rusak. Kapasitas bergantung versi (1 sampai 40).

## 3. Rancangan Sistem

**Arsitektur.** Next.js (TypeScript). Logika di `src/lib/sig/` tanpa ketergantungan framework: format pesan, blok tanda tangan, rantai penandatangan, dan verifikasi ditulis sendiri; primitif (ECDSA, SHA-256, AES-GCM, scrypt) dari Node `crypto`; `pdf-lib` untuk halaman QR; `qrcode` untuk gambar QR. Satu-satunya keadaan di server adalah brankas kunci.

**Brankas kunci.** Pembuatan kunci menyimpan nama, jabatan, institusi, kunci publik, dan kunci privat yang terenkripsi di `data/keystore/` (tidak ikut git). Penandatanganan membutuhkan kata sandi.

**Pesan yang ditandatangani.**
- Pesan dokumen: `KRIPTO-DOC1 | hash SHA-256 byte sebelum blok | id dokumen | sidik jari | ["nama","jabatan","institusi","waktu"] | tanda tangan QR`
- Pesan QR: `KRIPTO-QR1 | id dokumen | sidik jari | ["nama","jabatan","institusi","waktu"]`

**Alur tanda tangan pertama.** (1) Buka kunci privat. (2) Buat id dokumen acak dan tanda tangan QR. (3) Untuk PDF, tambahkan halaman terakhir berisi QR-Code dan keterangan penandatangan; berkas lain tidak diubah. (4) Hitung SHA-256 seluruh byte hasil. (5) Tanda tangani pesan dokumen. (6) Tambahkan blok `\n%KRIPTO-SIG-V1 <base64url JSON>\n` di akhir berkas, berisi hash, metadata, kunci publik, dan kedua tanda tangan.

**Beberapa penandatangan (pengayaan).** Penandatangan berikutnya menambah satu blok yang menandatangani semua byte sebelumnya (termasuk blok sebelumnya) dengan id dokumen yang sama. QR-Code halaman pengesahan hanya untuk penandatangan pertama; penandatangan lain menerima gambar QR-Code mereka sendiri. Kunci yang sama tidak boleh menandatangani dua kali, dan dokumen dengan tanda tangan yang tidak sah tidak dapat ditandatangani lagi.

**Verifikasi.** Blok dikupas dari akhir berkas; untuk tiap blok: hitung ulang hash byte sebelum blok dan bandingkan, periksa tanda tangan dokumen dan tanda tangan QR dengan kunci publik (dari blok, atau kunci yang dipilih pengguna), dan laporkan apakah kunci terdaftar di brankas. QR-Code diperiksa sendiri: tanda tangan QR harus sah, kunci harus sesuai sidik jarinya, dan id dokumen harus cocok dengan berkas.

**QR-Code.** Isinya tautan `.../#q=<payload>`; payload (JSON ringkas, base64url) memuat id dokumen, sidik jari, nama, jabatan, institusi, waktu, dan tanda tangan QR. Bagian setelah `#` tidak dikirim ke server; halaman verifikasi mengisinya otomatis saat QR dipindai.

**Aturan encoding ketat.** Blok dan payload harus berupa base64url dan JSON kanonik, sehingga tidak ada byte lain yang menghasilkan data yang sama.

**Antarmuka.** Tiga bagian: kunci (buat, daftar), tanda tangan (pilih kunci, kata sandi, berkas; QR dan unduhan), verifikasi (berkas, isi QR, pilihan kunci publik; tabel per penandatangan). `<sisipkan tangkapan layar>`

**Keputusan desain** (ADR-001): blok di akhir berkas, QR-Code dengan tanda tangan sendiri, rantai untuk beberapa penandatangan.

## 4. Implementasi

`<Sisipkan potongan kode dan jelaskan. Usulan:>`

1. `signDocument()` dan `verifyDocument()` di `src/lib/sig/service.ts`.
2. `parseBlocks()`, `encodeBlock()`, dan pesan yang ditandatangani di `src/lib/sig/format.ts`.
3. `sealPrivateKey()` dan `openPrivateKey()` di `src/lib/sig/keys.ts`.
4. `parseQr()` dan `verifyQr()` di `src/lib/sig/qr.ts`.

**Kebijakan keamanan.** Tidak ada kunci di kode atau repositori (`data/` diabaikan git); kunci privat hanya tersimpan terenkripsi; CSPRNG untuk kunci, salt, nonce, id; tanpa MD5, SHA-1, DES, RC4, ECB; batas ukuran berkas (10 MB) dan laju permintaan; kata sandi minimal 10 karakter. Hasil review: THR-001 (3 temuan diperbaiki, 1 diringankan, 8 risiko diterima).

## 5. Pengujian dan Analisis

Data uji: PDF 1, 5, dan 20 halaman serta berkas teks yang dibuat oleh skrip; kunci dibuat saat uji. `<Tambahkan PDF asli (surat, sertifikat) untuk demo.>`

### 5.1 Pembangkitan dan perlindungan kunci

| Operasi | Ulangan | Rerata (ms) | SD (ms) |
|---------|---------|-------------|---------|
| Bangkitkan pasangan kunci ECDSA P-256 | 100 | 0,03 | 0,05 |
| Enkripsi kunci privat (scrypt + AES-256-GCM) | 30 | 49,8 | 0,8 |
| Buka kunci privat dengan kata sandi | 30 | 50,0 | 0,9 |

**Analisis.** Membangkitkan kunci sangat murah; biaya nyata ada pada scrypt (sekitar 50 ms) yang sengaja dibuat mahal untuk menyulitkan tebakan kata sandi (batas 8 percobaan per menit ditambahkan di API). Berkas kunci di brankas tidak memuat teks kunci privat (dicek langsung).

### 5.2 Ukuran

| Objek | Ukuran (byte) |
|-------|---------------|
| Tanda tangan ECDSA P-256 (r‖s, dipakai) | 64 (tetap) |
| Tanda tangan bentuk DER (pembanding) | 71 (70-72) |
| Kunci publik (titik tak terkompresi) | 65 |
| Kunci publik SPKI DER / PEM | 91 / 178 karakter |
| Blok tanda tangan di akhir berkas | 693 |
| Payload QR-Code | 320 (versi 13, 69x69 modul, koreksi kesalahan M) |
| PDF 3 halaman sebelum dan sesudah tanda tangan | 7.205 dan 22.281 |

**Analisis.** Tanda tangan dan kunci publik sangat kecil (64 dan 65 byte). Blok 693 byte membawa dua tanda tangan, kunci publik, hash, dan metadata; tiap penandatangan tambahan menambah sekitar 680 byte. Pertambahan PDF sebesar 15 KB berasal dari halaman pengesahan (font dan gambar QR yang disematkan `pdf-lib`), bukan dari tanda tangan. Payload QR 320 byte menghasilkan versi 13 (69x69 modul), masih mudah dipindai. Gambar: `ukuran.png`.

### 5.3 Waktu penandatanganan dan verifikasi (>= 30 ulangan)

| Operasi | Ulangan | Rerata (ms) | SD (ms) |
|---------|---------|-------------|---------|
| ECDSA sign (pesan pendek) | 200 | 0,022 | 0,002 |
| ECDSA verify (pesan pendek) | 200 | 0,054 | 0,003 |

Sign dan verify dokumen lengkap, berkas biner acak (bukan PDF):

| Ukuran | SHA-256 saja (ms) | Sign lengkap (ms) | Verify lengkap (ms) |
|--------|------------------|-------------------|---------------------|
| 1 KB | 0,002 | 14,9 | 0,18 |
| 100 KB | 0,049 | 15,1 | 0,21 |
| 1 MB | 0,50 | 15,9 | 0,66 |
| 10 MB | 4,9 | 22,5 | 5,3 |

Dokumen PDF (30 ulangan): sign lengkap 31,8 sampai 42,2 ms, verify 0,17 sampai 0,19 ms untuk 1, 5, dan 20 halaman.

**Analisis.** Operasi ECDSA sendiri sangat cepat (0,02 ms sign dan 0,05 ms verify). Sign lengkap sekitar 15 ms hampir seluruhnya waktu pembuatan QR-Code (14,8 ms diukur terpisah), bukan tanda tangan. Verifikasi lebih cepat daripada penandatanganan lengkap dan tumbuh linear terhadap ukuran berkas karena didominasi SHA-256 (0,5 ms per MB); pada PDF, verifikasi tidak menyentuh `pdf-lib`. Gambar: `waktu-ukuran.png`, `waktu-pdf.png`.

### 5.4 Uji tamper

| Dokumen | Ubah 1 bit isi dokumen | Ubah 1 bit di blok tanda tangan | Tambah, potong, awalan | Berkas asli |
|---------|------------------------|--------------------------------|------------------------|-------------|
| PDF 1 halaman | 400 dari 400 terdeteksi | 693 dari 693 | 3 dari 3 | sah |
| PDF 5 halaman | 400 dari 400 | 693 dari 693 | 3 dari 3 | sah |
| PDF 20 halaman | 400 dari 400 | 693 dari 693 | 3 dari 3 | sah |
| teks 2 KB | 400 dari 400 | 693 dari 693 | 3 dari 3 | sah |
| teks pendek (18 B) | 18 dari 18 (semua posisi) | 693 dari 693 | 3 dari 3 | sah |

**Analisis.** Semua perubahan terdeteksi: 100% (1.618 percobaan isi dokumen pada posisi tersebar, 3.465 pada blok). Selain itu uji unit membalik satu bit pada **setiap** byte berkas bertanda tangan 666 byte. Uji ini menemukan kelemahan nyata pada rancangan awal: tanda tangan QR di dalam blok belum dilindungi tanda tangan dokumen, sehingga mengubahnya tidak membatalkan berkas (61 dari 666 pembalikan lolos). Sekarang tanda tangan dokumen mencakup tanda tangan QR dan diperiksa, dan seluruh pembalikan terdeteksi (THR-001, SF-1).

### 5.5 Uji kunci salah

| Skenario | Hasil |
|----------|-------|
| 50 kunci publik acak lain | 50 dari 50 ditolak (tanda tangan dokumen dan QR) |
| Kunci publik penandatangan | diterima |
| Penipu memakai nama yang sama dengan kunci sendiri | tanda tangan sah secara matematis, tetapi kunci **tidak terdaftar** |

**Analisis.** Kunci yang tidak cocok selalu gagal. Baris terakhir menunjukkan batas tanda tangan digital: tanda tangan sah hanya membuktikan pemilik suatu kunci, bukan identitasnya. Identitas dinilai dari sidik jari kunci yang terdaftar di brankas; sistem tanpa daftar tepercaya (atau sertifikat) tidak dapat membedakan penipu.

### 5.6 Uji QR-Code palsu

| Skenario | Hasil |
|----------|-------|
| nama, jabatan, institusi, waktu, id dokumen, atau sidik jari diubah (6 uji) | semua ditolak |
| tanda tangan di QR: 1 bit dibalik pada tiap byte (64 uji) | 64 dari 64 ditolak |
| QR penandatangan lain ditempel | ditolak |
| QR sah milik dokumen lain (penandatangan sama) | ditolak (id dokumen tidak cocok) |
| teks bukan payload | ditolak |
| QR asli | diterima |

**Analisis.** QR-Code tidak dapat ditulis ulang tanpa kunci privat. QR yang sah hanya membuktikan penandatangan dan id dokumen, bukan isi dokumen; karena itu verifikasi QR dibandingkan dengan id dokumen berkasnya (temuan SF-2), dan keutuhan isi tetap tugas tanda tangan dokumen. Pengujian gambar QR: gambar yang dihasilkan didekode kembali dengan `jsqr` menjadi tautan yang sama (uji unit); pemindaian dengan kamera ponsel belum dicoba.

### 5.7 Beberapa penandatangan (pengayaan)

| Penandatangan | Ukuran berkas (B) | Tambahan (B) | Verifikasi (ms) | Berkas utuh | 1 bit isi diubah |
|---------------|------------------|--------------|-----------------|-------------|------------------|
| 1 | 20.151 | 0 | 0,18 | 1 dari 1 sah | 1 dari 1 ditolak |
| 2 | 20.831 | 680 | 0,31 | 2 dari 2 | 2 dari 2 |
| 3 | 21.511 | 1.360 | 0,50 | 3 dari 3 | 3 dari 3 |
| 4 | 22.191 | 2.040 | 0,62 | 4 dari 4 | 4 dari 4 |
| 5 | 22.871 | 2.720 | 0,88 | 5 dari 5 | 5 dari 5 |

**Analisis.** Ukuran dan waktu verifikasi bertambah linear terhadap jumlah penandatangan (680 byte dan sekitar 0,17 ms per orang). Mengubah isi dokumen membatalkan semua tanda tangan; menghapus penandatangan terakhir meninggalkan yang sebelumnya tetap sah (uji unit). Batas: pembaca PDF tertentu (poppler) melaporkan peringatan xref yang dapat diperbaiki bila lebih dari sekitar 1 KB data mengikuti akhir berkas, yaitu mulai dua penandatangan; isi tetap terbaca. Gambar: `multi-waktu.png`, `multi-ukuran.png`.

### 5.8 Skenario demo UTS
Tanda tangani PDF; pindai QR-Code (atau tempel isinya) untuk verifikasi berhasil; ubah satu karakter berkas lalu verifikasi gagal ("dokumen diubah setelah tanda tangan"); uji dengan kunci publik yang salah (gagal). Diuji pada server sungguhan: pembuatan kunci, kata sandi salah (401), tanda tangan, verifikasi sah, berkas diubah, kunci terdaftar lain (ditolak), kunci PEM lain (ditolak), tanda tangan kedua, kunci tak dikenal dan id yang mencoba keluar dari direktori (400), dan berkas 12 MB (413).

## 6. Kesimpulan dan Saran

Aplikasi memenuhi seluruh fitur dan pengujian wajib topik D dan pengayaan beberapa penandatangan. ECDSA P-256 memberi tanda tangan 64 byte yang dibuat dalam 0,02 ms dan diperiksa dalam 0,05 ms; keutuhan terjamin (semua perubahan satu bit pada dokumen dan blok terdeteksi), kunci salah dan QR palsu ditolak, dan kunci privat hanya tersimpan terenkripsi. Keterbatasan yang terukur: kepercayaan bertumpu pada daftar kunci lokal, bukan sertifikat; QR-Code memerlukan pemeriksaan id dokumen; blok setelah akhir PDF dapat memicu peringatan pada sebagian pembaca.

Saran: sertifikat dan pencabutan kunci; cap waktu tepercaya (mis. hash di blockchain testnet); tanda tangan ganda ECDSA dan ML-DSA (pasca-kuantum) sebagai pengayaan berikutnya; tanda tangan PDF standar (PAdES) agar diterima pembaca tanpa peringatan; penandatanganan di sisi klien agar kata sandi tidak meninggalkan peramban.

## 7. Referensi

> Format APA 7, minimal 10 sumber termasuk minimal satu publikasi dosen pengampu. **Lengkapi dan verifikasi tiap entri lewat Mendeley; daftar ini kandidat, bukan untuk disalin apa adanya.** Lembar tugas menyebut tiga publikasi dosen yang relevan untuk topik ini; ambil rincian lengkapnya dari sumber aslinya.

Dosen pengampu (dari lembar tugas):
1. Gunawan, Rahmatulloh, & Rizal (2024). Tanda tangan digital berbasis QR-Code. `<judul lengkap, jurnal, volume, halaman, DOI>`
2. SignChain dengan HashIDs di blockchain (2024). `<penulis, judul lengkap, sumber, DOI>` (demo: signchain.if.unsil.ac.id)
3. Raihan, & Rahmatulloh (2026). ECDSA dan ML-DSA. `<judul lengkap, jurnal, volume, halaman, DOI>` (demo: sidigs.if.unsil.ac.id)

Kandidat (verifikasi rincian):
4. National Institute of Standards and Technology. (2023). *Digital Signature Standard (DSS)* (FIPS 186-5). NIST.
5. Johnson, D., Menezes, A., & Vanstone, S. (2001). The elliptic curve digital signature algorithm (ECDSA). *International Journal of Information Security, 1*(1).
6. National Institute of Standards and Technology. (2015). *Secure Hash Standard (SHS)* (FIPS 180-4). NIST.
7. Percival, C., & Josefsson, S. (2016). *The scrypt password-based key derivation function* (RFC 7914). IETF.
8. Dworkin, M. (2007). *Recommendation for block cipher modes of operation: Galois/Counter Mode (GCM) and GMAC* (NIST SP 800-38D). NIST.
9. International Organization for Standardization. (2015). *Information technology: Automatic identification and data capture techniques: QR Code bar code symbology specification* (ISO/IEC 18004:2015). ISO.
10. Adobe Systems. (2008). *Document management: Portable document format: Part 1: PDF 1.7* (ISO 32000-1:2008). ISO.
11. Merkle, R. C. (1980). Protocols for public key cryptosystems. *Proceedings of the IEEE Symposium on Security and Privacy*.
12. National Institute of Standards and Technology. (2024). *Module-lattice-based digital signature standard* (FIPS 204). NIST.
13. Materi Section 7 (digital signature), Keamanan Informasi, Informatika UNSIL.

## Lampiran A. Penggunaan asisten AI
Lihat `laporan/lampiran-penggunaan-ai.md`. Setiap anggota harus dapat menjelaskan seluruh kode.

## Lampiran B. Daftar periksa pengumpulan

- [ ] Semua fitur wajib berjalan; skenario demo dicoba di laptop demo (termasuk pemindaian QR dengan ponsel)
- [ ] Semua pengujian wajib dijalankan; angka bab 5 sesuai hasil terbaru
- [ ] README lengkap; aplikasi jalan di komputer lain
- [ ] Tidak ada kunci/sandi di repositori, termasuk riwayat git; folder `data/` tidak ikut commit
- [ ] Riwayat commit dari setiap anggota
- [ ] Tautan repo dan video di sampul; nama berkas `TugasKripto_D_<NPM-Ketua>.pdf`
- [ ] XLSX hasil uji dikumpulkan bersama laporan
