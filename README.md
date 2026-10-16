# Website Pendaftaran Daurah "Tajidul Iman"

Form pendaftaran peserta daurah Muslim Solo. Frontend statis (HTML/CSS/JS, tanpa build), backend Google Apps Script + Google Sheet + Google Drive.

Dokumen acuan: `prd.md` (kebutuhan), `architecture.md` (teknis), `design (1).md` (tampilan).

## Struktur

```
index.html            halaman tunggal
style.css             tampilan
app.js                logika form (CONFIG ada di bagian atas)
assets/               icon.png (logo & favicon), qris_ms.jpeg (QRIS)
apps-script/Code.gs   backend (disalin ke editor Apps Script)
```

## Yang wajib disiapkan pemilik sebelum rilis

| # | Item | Diisi di |
|---|---|---|
| 1 | ID folder Drive privat untuk bukti bayar | `Code.gs` → `CONFIG.DRIVE_FOLDER_ID` |
| 2 | Kuota (opsional, `0` = tanpa batas) | `Code.gs` → `CONFIG.QUOTA_MAX` |
| 3 | URL Web App Apps Script | `app.js` → `CONFIG.API_URL` |

Sudah terisi: tanggal (`CONFIG.EVENT.DATE_LABEL`), waktu, link Google Maps (`CONFIG.EVENT.MAPS_URL`), link donasi (`CONFIG.DONATION_URL`), QRIS (`assets/qris_ms.jpeg`), logo & favicon (`assets/icon.png`).

## Langkah deploy

### 1. Backend (Google Apps Script)
1. Buat folder baru di Google Drive akun Muslim Solo, misalnya `Bukti Bayar Tajidul Iman`. Pastikan berbaginya **Dibatasi** (tidak publik). Salin ID folder dari URL: `drive.google.com/drive/folders/<ID_FOLDER>`.
2. Buat Google Spreadsheet baru → menu **Extensions → Apps Script**.
3. Hapus isi `Code.gs` bawaan, tempel seluruh isi `apps-script/Code.gs`, isi `DRIVE_FOLDER_ID` (dan `QUOTA_MAX` bila perlu), lalu simpan.
4. Pilih fungsi `setup` → **Run**. Beri izin akses Sheets & Drive. Tab `Putra` dan `Putri` akan dibuat lengkap dengan header, dropdown status, dan warna status.
5. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Salin URL yang berakhiran `/exec`.

### 2. Frontend
1. Buka `app.js`, isi `CONFIG.API_URL` dengan URL `/exec` tadi.
2. Unggah `index.html`, `style.css`, `app.js`, dan folder `assets/` ke hosting statis (mis. subdomain `daftar.muslimsolo.id`). Folder `apps-script/` dan file `.md` tidak perlu diunggah.

### 3. Setiap mengubah `Code.gs`
**Deploy → Manage deployments → Edit (ikon pensil) → Version: New version → Deploy.** URL tetap sama.

## Mencoba di komputer sendiri

Buka lewat server lokal (bukan klik dua kali file), misalnya:

```powershell
npx serve .
```

lalu buka alamat yang ditampilkan.

## Panduan admin (Google Sheet)

- Setiap pendaftar = satu baris. Kolom `Status Pembayaran` terisi otomatis:
  - QRIS → `Menunggu Verifikasi` (buka `Link Bukti Bayar`, cocokkan dengan mutasi, lalu ubah ke `Lunas` atau `Ditolak`).
  - Tunai → `Belum Bayar (Bayar di Lokasi)` (ubah ke `Lunas` saat membayar di lokasi).
- `Catatan Admin` bebas diisi.
- Peserta laki-laki masuk tab `Putra`, perempuan masuk tab `Putri`. No. Registrasi, cek pendaftaran ganda, dan kuota dihitung gabungan kedua tab.
- Satu nomor WhatsApp boleh dipakai beberapa peserta (mis. keluarga). Yang ditolak hanya bila nama **dan** nomor WA sama persis dengan pendaftar sebelumnya.
- Jangan mengubah urutan kolom atau nama tab `Putra` / `Putri`.
- Link bukti bayar hanya bisa dibuka akun pemilik / yang diberi akses ke folder.

## Pengujian sebelum rilis

- Di editor Apps Script, jalankan `testSubmit()` lalu lihat **Execution log**. Fungsi ini menulis baris uji ke Sheet dan file uji ke Drive; hapus setelah selesai.
- Uji 5 submit paralel (nomor registrasi harus unik). Buka website, tekan F12 → Console, tempel:

```js
await Promise.all([1,2,3,4,5].map(i => fetch(CONFIG.API_URL, {
  method: "POST",
  headers: { "Content-Type": "text/plain;charset=utf-8" },
  body: JSON.stringify({ name: "Uji Paralel " + i, gender: "Laki-laki", age: 30,
    whatsapp: "08129999000" + i, city: "Surakarta", paymentMethod: "Tunai", commitment: true })
}).then(r => r.json()))).then(r => console.table(r.map(x => x.data || x)));
```

- Jalankan skenario AT-01 s.d. AT-10 di `prd.md` §11 dari HP asli (coba juga PDF, PNG transparan, dan foto kamera besar).
