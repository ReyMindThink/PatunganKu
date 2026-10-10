# Kontrak API PatunganKu

Dokumen ini adalah sumber kebenaran antarmuka antara backend dan frontend. Setiap perubahan endpoint, bentuk respons, atau event diperbarui di sini lebih dulu. Desain data dan aturan bisnis ada di docs/architecture.md.

Status: rancangan (Tahap 0). Belum ada endpoint baru yang dibuat. Bagian ini hanya konvensi umum. Daftar endpoint per modul ditambahkan di bagian berikutnya.

## 1. Cara membaca

- Awalan semua rute adalah /api. Rute grup berbentuk /api/groups/:groupId/...
- Endpoint yang sudah berjalan (auth, grup, transaksi, saldo, pelunasan, struk) mengikuti konvensi ini setelah dimigrasi di Tahap 1. Bentuk respons endpoint lama belum diperiksa untuk dokumen ini, dan tabel migrasinya ditulis setelah controller dibaca.
- Perubahan yang merusak klien (breaking change) dicatat di dokumen ini. Tidak ada nomor versi di URL selama klien hanya satu (frontend tim). Penomoran versi baru dipertimbangkan bila ada klien lain.

## 2. Konvensi umum

### 2.1 Format data

- Body permintaan dan respons memakai JSON UTF-8.
- Waktu memakai ISO 8601 UTC, misalnya 2026-10-10T08:30:00.000Z.
- Uang berupa bilangan bulat rupiah (tipe number di JSON), tanpa desimal. Backend menolak nilai di luar rentang aman dan di atas batas Rp100.000.000 per transaksi. Pemformatan (titik ribuan, simbol Rp) dilakukan klien.
- Id berupa bilangan bulat untuk saat ini. Klien memperlakukan id sebagai nilai buram dan tidak melakukan aritmetika padanya.
- Nama kolom memakai camelCase. Nilai status memakai huruf besar seperti di architecture.md (misalnya PENDING_APPROVAL, HOLDING).

### 2.2 Autentikasi

- Header Authorization: Bearer <token>. Token JWT berlaku 1 jam. Refresh token baru ada di Tahap 2, sehingga sampai saat itu pengguna login ulang setelah token habis.
- Token tidak ada atau tidak valid: 401 dengan code unauthorized.
- Bukan anggota ACTIVE grup, atau tidak berhak atas aksi: 403 dengan code forbidden. Aturan siapa boleh apa ada di architecture.md bagian 7.4.
- Teks dari pengguna (chat, nama item dari struk, alasan revisi) adalah data tak tepercaya. Klien merender sebagai teks biasa dan tidak sebagai HTML.

### 2.3 Format error (RFC 9457)

Semua error memakai Content-Type application/problem+json dengan bentuk berikut.

    {
      "type": "about:blank",
      "title": "Conflict",
      "status": 409,
      "code": "item-unavailable",
      "detail": "Unit item sudah diambil anggota lain."
    }

| Field | Isi |
|---|---|
| type | about:blank (tanpa semantik tambahan di luar status HTTP). |
| title | Frasa standar status HTTP. |
| status | Kode status HTTP. |
| code | Kode mesin dalam huruf kecil dengan tanda hubung. Klien memakai field ini untuk logika, bukan detail. |
| detail | Kalimat bahasa Indonesia untuk ditampilkan ke pengguna. |
| errors | Hanya untuk validation-failed: daftar objek berisi field dan message. |

Contoh validasi:

    {
      "type": "about:blank",
      "title": "Bad Request",
      "status": 400,
      "code": "validation-failed",
      "detail": "Data yang dikirim tidak valid.",
      "errors": [{ "field": "amount", "message": "Harus bilangan bulat positif" }]
    }

Perubahan dari format lama: error menjadi code, dan message menjadi detail. Format lama {error, message} dipensiunkan di Tahap 1 bersama migrasi endpoint, termasuk koleksi Postman.

Kode awal (daftar lengkap dan pemetaan dari kode lama menyusul):

| code | Status | Arti |
|---|---|---|
| validation-failed | 400 | Body atau query tidak lolos validasi. |
| invalid-json | 400 | Body bukan JSON yang valid (sudah ada). |
| unauthorized | 401 | Token tidak ada, tidak valid, atau kedaluwarsa. |
| forbidden | 403 | Tidak berhak atas aksi atau grup ini. |
| not-found | 404 | Data tidak ada. |
| invalid-state | 409 | Aksi tidak boleh pada status sekarang (misalnya menyetujui Approval yang sudah EXPIRED). |
| version-conflict | 409 | baseVersion tidak sama dengan versi terbaru. |
| item-unavailable | 409 | Unit item tidak cukup atau sudah diambil. |
| amount-exceeds-debt | 409 | Nominal pelunasan melebihi utang yang tersisa. |
| idempotency-key-reuse | 409 | Idempotency-Key yang sama dipakai dengan isi permintaan berbeda. |
| request-in-progress | 409 | Permintaan dengan kunci yang sama masih diproses. |
| payload-too-large | 413 | Berkas melebihi 5 MB. |
| unsupported-media-type | 415 | Tipe berkas tidak diizinkan (diperiksa dari byte awal). |
| rate-limited | 429 | Terlalu banyak permintaan. Disertai header Retry-After (Tahap 4). |
| upstream-error | 502 | Layanan eksternal (Gemini) gagal. Status transaksi tidak berubah. |
| internal-error | 500 | Kesalahan server. |

### 2.4 Kode status

| Status | Dipakai untuk |
|---|---|
| 200 | Berhasil membaca atau mengubah. |
| 201 | Berhasil membuat sumber daya baru. |
| 204 | Berhasil tanpa isi respons. |
| 400 | Permintaan salah bentuk atau tidak lolos validasi. |
| 401 | Belum terautentikasi. |
| 403 | Terautentikasi tetapi tidak berhak. |
| 404 | Tidak ditemukan. |
| 409 | Konflik dengan keadaan sekarang, termasuk balapan klaim dan pelanggaran aturan yang bergantung data. |
| 413, 415 | Berkas terlalu besar atau tipe tidak diizinkan. |
| 429 | Dibatasi laju. |
| 500, 502 | Kesalahan server atau layanan eksternal. |

Status 422 tidak dipakai, supaya klien tidak perlu membedakan 409 dan 422 untuk kasus yang mirip.

### 2.5 Pagination

Semua endpoint daftar yang bisa panjang memakai kursor, bukan nomor halaman, supaya data baru tidak menggeser hasil.

- Query: limit (bilangan bulat, bawaan 20, maksimal 100) dan cursor (string buram dari respons sebelumnya).
- Respons berbentuk berikut.

    {
      "data": [ ... ],
      "page": { "nextCursor": "abc123", "hasMore": true }
    }

- Jika tidak ada halaman lagi, hasMore bernilai false dan nextCursor null.
- Urutan bawaan: terbaru lebih dulu. Untuk chat, klien memakai parameter after (id pesan) untuk menyusul pesan yang terlewat setelah koneksi terputus.
- Endpoint yang hasilnya selalu kecil (anggota grup, daftar metode pembayaran) boleh mengembalikan {data: [...]} tanpa page.

### 2.6 Idempotency

Dobel-tap atau percobaan ulang jaringan tidak boleh menulis entri ledger dua kali.

- Header Idempotency-Key berisi UUID v4 yang dibuat klien untuk tiap niat aksi. Wajib untuk: pembuatan transaksi, penandaan Done dan klaim item, pengiriman pelunasan, konfirmasi pelunasan, pemberian suara Approval, penandaan dibayar dana, dan penambahan dana. Tanpa header: 400 dengan code validation-failed.
- Kunci disimpan per pengguna selama 24 jam (konstanta di constants.js). Permintaan ulang dengan kunci, metode, dan path yang sama mengembalikan respons tersimpan dan header Idempotent-Replay: true.
- Kunci sama dengan isi permintaan berbeda: 409 idempotency-key-reuse. Permintaan pertama masih berjalan: 409 request-in-progress.

### 2.7 Konflik versi

Objek yang bisa direvisi (Transaction) membawa field version. Permintaan revisi menyertakan baseVersion. Jika berbeda dari versi terbaru, respons 409 version-conflict, dan klien mengambil ulang data lalu mengajukan ulang.

### 2.8 Penyamaran data

Server yang memutuskan apa yang boleh terlihat, bukan klien.

- Nama pemegang dana hanya dikirim kepada admin dan pemegang. Anggota lain menerima nama tampilan Dana Kelompok tanpa id pemegang. Penalang pada pelunasan dari dana adalah pengecualian yang diterima (architecture.md 8.1).
- Nomor rekening hanya dikirim kepada pihak yang berutang kepada atau dipiutangi pemiliknya.
- Pelaku entri dana (createdBy) tidak dikirim kepada anggota selain admin dan pemegang.
- Mantan anggota hanya menerima data ledger miliknya.

## 3. Socket.IO

### 3.1 Koneksi

- Klien menyambung dengan token pada handshake (opsi auth: { token }). Server memverifikasi JWT sebelum koneksi diterima. Token tidak valid: koneksi ditolak dengan pesan unauthorized.
- Server memutus koneksi saat token kedaluwarsa dengan alasan token-expired. Klien menyambung ulang dengan token baru. Sampai refresh token tersedia (Tahap 2), pengguna perlu login ulang.
- Satu instance server dulu. Di Azure App Service, WebSocket harus diaktifkan.

### 3.2 Room dan hak akses

- Setelah handshake, server memasukkan klien ke room group:<id> hanya untuk grup tempat ia anggota ACTIVE, dan ke room user:<id> untuk notifikasi pribadi.
- Perubahan keanggotaan berlaku seketika: anggota yang keluar atau dikeluarkan langsung dikeluarkan dari room grup itu.
- Klien tidak dapat memilih room sendiri. Aksi lewat socket diperiksa ulang hak aksesnya seperti rute REST.

### 3.3 Aturan event

- Sumber kebenaran adalah REST. Event hanya memberi tahu bahwa ada perubahan, dengan muatan minimal (jenis, id, version bila ada, serverTime). Klien mengambil data terbaru lewat REST bila perlu.
- Event tidak diulang setelah koneksi terputus. Klien yang tersambung kembali mengambil ulang data yang tampil (kartu aktif, notifikasi belum dibaca, chat dengan parameter after).
- Penamaan event: <domain>:<aksi> dengan huruf kecil, misalnya item:claimed, approval:decided, message:created. Daftar event lengkap ditulis bersama endpoint tiap modul.
- Aksi menulis (klaim item, Done, kirim pesan) tetap lewat REST dengan Idempotency-Key. Socket hanya untuk menyiarkan hasilnya, supaya satu jalur penulisan dan satu jalur validasi.

<!-- akhir-bagian-api-1 -->
