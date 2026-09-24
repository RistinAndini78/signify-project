# kripto-digital-signature

Tugas Proyek Aplikasi Kriptografi, Keamanan Informasi, Informatika UNSIL.
Topik D: Aplikasi Digital Signature

## Anggota
| Nama | NPM |
|------|-----|
| <nama> | <NPM> |

## Deskripsi
Aplikasi web (Next.js + TypeScript) untuk menandatangani dokumen elektronik dan memverifikasinya.

- **Algoritma**: ECDSA P-256 dengan SHA-256 (Node `crypto`); tanda tangan atas hash SHA-256 berkas, 64 byte.
- **Brankas kunci**: kunci privat disimpan terenkripsi (AES-256-GCM, kunci dari kata sandi dengan scrypt) di `data/keystore/`; tidak pernah di kode sumber atau repositori.
- **QR-Code**: PDF mendapat halaman terakhir berisi QR-Code dan keterangan penandatangan. QR memuat JSON mandiri dengan metadata (nama, jabatan, institusi, waktu), ID dokumen, fingerprint kunci, dan tanda tangan; QR lama berbentuk tautan tetap dapat diverifikasi.
- **Blok tanda tangan**: `\n%KRIPTO-SIG-V1 <base64url JSON>\n` ditambahkan di akhir berkas (berisi hash, metadata, kunci publik, tanda tangan dokumen dan QR); berkas non-PDF juga didukung.
- **Verifikasi**: menolak dokumen yang diubah (satu byte), kunci publik yang tidak cocok, dan QR yang dipalsukan; melaporkan apakah kunci terdaftar.
- **Pengayaan**: beberapa penandatangan pada satu dokumen (tiap blok menandatangani semua byte sebelumnya).

Alasan desain: ADR-001 di `.assist/`.

## Instalasi
```bash
npm install
```
Opsional: `PUBLIC_URL=http://192.168.x.x:3000` agar QR-Code memuat alamat yang dapat dijangkau ponsel; `KEYSTORE_DIR` untuk lokasi brankas. Tidak ada rahasia yang perlu dikonfigurasi.

## Menjalankan
```bash
npm run dev      # http://localhost:3000
```

Untuk memindai QR dari ponsel, jalankan server dengan alamat yang dapat dijangkau ponsel. `PUBLIC_URL` adalah pilihan paling stabil; ganti alamatnya dengan IPv4 laptop di jaringan Wi-Fi yang sama:

```powershell
$env:PUBLIC_URL="http://192.168.x.x:3000"; npm run dev
```

Tanpa `PUBLIC_URL`, aplikasi mencoba memakai alamat IPv4 LAN secara otomatis. Jangan gunakan `localhost` untuk QR yang akan dipindai dari ponsel karena `localhost` pada ponsel menunjuk ke ponsel itu sendiri.

## Contoh penggunaan
1. **Buat kunci**: isi nama, jabatan, institusi, dan kata sandi kunci (minimal 10 karakter).
2. **Tanda tangani**: pilih kunci, masukkan kata sandi, pilih PDF; unduh berkas `.signed.pdf` dan lihat QR-Code. Hanya berkas PDF yang diterima. Berkas yang sudah ditandatangani dapat ditandatangani penandatangan berikutnya.
3. **Verifikasi**: unggah berkas bertanda tangan; tempel JSON hasil scan QR. Tabel menunjukkan tiap penandatangan.
4. **Uji**: ubah satu karakter berkas dan verifikasi lagi (gagal); pilih kunci publik lain (gagal); ubah isi QR (gagal).

API dengan curl:
```bash
curl -X POST localhost:3000/api/keys -H 'content-type: application/json' -d '{"name":"Dr. A","title":"Dosen","org":"UNSIL","passphrase":"kata-sandi-panjang"}'
curl -X POST localhost:3000/api/sign -F keyId=<id> -F passphrase=kata-sandi-panjang -F file=@surat.pdf > signed.json    # file (Base64), qr.text, ...
curl -X POST localhost:3000/api/verify -F file=@surat.signed.pdf -F "qr=<qr.txt"
```

## Pengujian
```bash
npm test          # 19 unit test (termasuk pembalikan bit pada setiap byte berkas bertanda tangan)
npm run bench     # pengujian wajib -> data-uji/hasil/hasil-pengujian.xlsx dan hasil.json
npm run charts    # grafik SVG di laporan/gambar/
```
Hasil: `data-uji/hasil/`.

## Keamanan
Tidak ada kunci atau kata sandi di repo; `data/` (brankas) diabaikan git, jangan di-commit. Kata sandi kunci dikirim ke server saat menandatangani: gunakan HTTPS di luar localhost. Hasil review: `.assist/cyber-security/report/THR-001-security-review.md`.
