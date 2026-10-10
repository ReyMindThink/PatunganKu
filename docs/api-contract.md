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

- Header Idempotency-Key berisi UUID v4 yang dibuat klien untuk tiap niat aksi. Wajib untuk: pembuatan transaksi, penandaan Done dan klaim item, pengiriman pelunasan, konfirmasi pelunasan, pemberian suara Approval, consent peserta, penandaan dibayar dana, dan penambahan dana. Tanpa header: 400 dengan code validation-failed.
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

## 4. Migrasi dari endpoint yang sudah berjalan

Bagian ini mencatat perubahan yang diperlukan pada kode Tahap sebelumnya agar mengikuti konvensi di bagian 2 dan 3. Dibuat dari pembacaan kode backend yang ada.

### 4.1 Pemetaan kode error

Format lama: { error, message }. Format baru: RFC 9457 dengan code dan detail (bagian 2.3). Kode domain (yang tetap spesifik) boleh ditambahkan di luar tabel 2.3 bila klien perlu membedakannya untuk tampilan.

| Kode lama | Status lama | Kode baru | Status baru | Catatan |
|---|---|---|---|---|
| invalid-id | 400 | validation-failed | 400 | Diganti satu middleware bersama. |
| invalid-upload | 400 | validation-failed | 400 | |
| file-required | 400 | validation-failed | 400 | |
| invalid-json | 400 | invalid-json | 400 | Tetap. |
| unauthorized | 401 | unauthorized | 401 | Tetap. |
| invalid-credentials | 401 | invalid-credentials | 401 | Kode domain, tetap. |
| user-not-found | 404 | unauthorized | 401 | Token valid tetapi user sudah tidak ada. Klien login ulang. |
| forbidden | 403 | forbidden | 403 | Tetap. |
| group-not-found | 404 | not-found | 404 | |
| payment-not-found | 404 | not-found | 404 | |
| transaction-not-found | 404 | not-found | 404 | |
| email-taken | 409 | email-taken | 409 | Kode domain, tetap. |
| already-member | 409 | already-member | 409 | Kode domain, tetap. |
| already-decided | 409 | invalid-state | 409 | |
| already-verified | 409 | invalid-state | 409 | |
| no-receipt | 400 | invalid-state | 409 | Status HTTP berubah. Permintaan benar, status transaksi belum memungkinkan. |
| invalid-receiver | 400 | invalid-receiver | 400 | Kode domain, tetap. |
| file-too-large | 413 | payload-too-large | 413 | |
| unsupported-type | 415 | unsupported-media-type | 415 | |
| verifier-unavailable | 502 | upstream-error | 502 | |
| code-generation-failed | 500 | internal-error | 500 | Detail asli hanya masuk log server. |
| internal-error | 500 | internal-error | 500 | Tetap. |

Empat kode domain tambahan di luar tabel 2.3: email-taken, already-member, invalid-credentials, dan invalid-receiver (empat, termasuk yang tetap dari tabel di atas).

### 4.2 Perapian rute dan kode

- Parameter rute grup diseragamkan menjadi :groupId (sebelumnya :id di rute grup). URL tidak berubah, hanya nama parameter di kode.
- Pemeriksaan id (invalid-id) yang sekarang diulang di lima controller diganti satu middleware bersama yang menghasilkan validation-failed.
- Koleksi Postman (docs/postman/build.mjs) diperbarui mengikuti format error baru dan status no-receipt yang berubah.

<!-- akhir-bagian-api-2 -->

## 5. Bentuk respons sukses

### 5.1 Aturan

Keputusan: semua respons sukses dibungkus data. Klien memiliki satu pola baca untuk semua endpoint.

| Jenis | Bentuk |
|---|---|
| Satu objek | { "data": { ... } }. Objeknya langsung di dalam data, tanpa pembungkus bernama tambahan. |
| Daftar kecil (selalu muat satu layar) | { "data": [ ... ] } |
| Daftar yang bisa panjang | { "data": [ ... ], "page": { "nextCursor": "...", "hasMore": true } } (bagian 2.5) |
| Aksi tanpa hasil (hapus, tandai dibaca) | 204 tanpa isi. |
| Error | application/problem+json (bagian 2.3). Tidak pernah dibungkus data. |

Respons yang menggabungkan beberapa hal (misalnya transaksi beserta hasil verifikasinya) tetap satu objek di dalam data, dengan field bernama yang jelas. Klien tidak boleh bergantung pada urutan field.

### 5.2 Migrasi respons yang sudah berjalan

Dibuat dari pembacaan res.json di controller. Frontend belum terhubung ke backend, sehingga perubahan ini belum merusak klien mana pun.

| Endpoint | Bentuk lama | Bentuk baru |
|---|---|---|
| GET /api/auth/me | { user } | { data: user } |
| POST /api/groups | 201, { group } | 201, { data: group } |
| POST /api/groups/join | { group } | { data: group } |
| GET /api/groups | { groups } | { data: [ ...groups ] } (tanpa page) |
| GET /api/groups/:groupId | { group } | { data: group } |
| POST /api/groups/:groupId/transactions | 201, { transaction } | 201, { data: transaction } |
| GET /api/groups/:groupId/transactions | { transactions } (semua baris) | { data: [ ... ], page } (kursor) |
| POST /api/groups/:groupId/payments | 201, { payment } | 201, { data: payment } |
| PATCH /api/groups/:groupId/payments/:paymentId | { payment } | { data: payment } |
| GET /api/groups/:groupId/payments | { payments } (semua baris) | { data: [ ... ], page } (kursor) |
| POST .../transactions/:transactionId/receipt | { transaction } | { data: transaction } |

Endpoint yang mengirim objek langsung tanpa pembungkus bernama (register, login, saldo, verifikasi struk) dipetakan setelah bentuknya diperiksa. Bagian itu ditambahkan sebagai 5.3.

<!-- akhir-bagian-api-3 -->

### 5.3 Respons objek langsung

Endpoint di bawah mengirim objek langsung tanpa pembungkus bernama. Dibuat dari pembacaan controller dan service.

| Endpoint | Bentuk lama | Bentuk baru |
|---|---|---|
| POST /api/auth/register | 201, { user, token } | 201, { data: { user, token } } |
| POST /api/auth/login | { user, token } | { data: { user, token } } |
| POST .../transactions/:transactionId/receipt/verify | { transaction, decision, detected: { total, confidence } } | { data: { transaction, decision, detected: { total, confidence } } } |
| GET /api/groups/:groupId/balances | Bentuk belum diperiksa | Dirancang ulang di bagian saldo (ledger append-only dan pelunasan bilateral, K3). Bukan sekadar dibungkus. |

Catatan:
- user pada register dan login memakai bentuk user publik dari toPublicUser. Daftar field pastinya dicatat di bagian auth. Setelah migrasi Tahap 0, field phone tidak ada lagi.
- Nilai decision pada verifikasi struk mengikuti utils/receiptDecision.js. Daftar nilainya ditulis di bagian struk setelah file itu dibaca.
- Setelah migrasi ledger, hasil verifikasi juga menghasilkan versi ReceiptExtraction (architecture.md 6.3). Bentuk akhirnya ditulis di bagian struk.

<!-- akhir-bagian-api-3b -->

### 5.4 Catatan dari pembacaan kode saldo dan keputusan struk

Status struk. Kode lama memakai RECEIPT_STATUS.REJECTED untuk struk yang gagal. Di rancangan, Transaction.status = REJECTED berarti persetujuan ditolak, sehingga satu kata bermakna dua hal. Status struk lama REJECTED dipetakan menjadi FAILED. Nilai receiptStatus yang berlaku: PENDING, VERIFIED, FAILED, NEEDS_REVIEW (architecture.md 6.1).

Alasan keputusan (field decision.reason pada verifikasi struk). Nilai lama dipertahankan dan dua nilai baru ditambahkan.

| reason | receiptStatus | Arti |
|---|---|---|
| ok | VERIFIED | Struk valid dan total sama dengan nominal transaksi. |
| not-a-receipt | FAILED | Gambar bukan struk. |
| low-confidence | FAILED | Keyakinan di bawah ambang 0,6 (MIN_CONFIDENCE). |
| total-unreadable | FAILED | Total pada struk tidak terbaca. |
| total-mismatch | FAILED | Total struk tidak sama dengan nominal transaksi. |
| tax-mode-unknown | NEEDS_REVIEW | PPN tidak dapat dipastikan eksklusif atau inklusif. Baru. |
| arithmetic-mismatch | NEEDS_REVIEW | Item ditambah service, pajak (bila eksklusif), dan ongkir dikurangi diskon tidak sama dengan total. Baru. |

Nilai constants.js lain untuk RECEIPT_STATUS belum diperiksa untuk dokumen ini.

Saldo. getBalances saat ini menghitung semua transaksi tanpa melihat status struk, dan daftar anggotanya tidak menyaring status keanggotaan. Keduanya tidak dipertahankan: saldo yang baru dihitung dari LedgerEntry (architecture.md 6.2), dan CHARGE hanya ditulis setelah transaksi lolos. Pemeriksaan keseimbangan total yang sekarang berupa console.error dipertahankan sebagai pemeriksaan kesehatan.

<!-- akhir-bagian-api-3c -->

## 6. Persetujuan dan notifikasi

### 6.1 Kode error tambahan

| code | Status | Arti |
|---|---|---|
| already-voted | 409 | Pengguna sudah memberi suara pada Approval ini. |

Kondisi lain memakai kode yang sudah ada: forbidden (pengaju atau bukan pemilih yang sah), invalid-state (Approval tidak lagi OPEN atau sudah kedaluwarsa), dan not-found.

### 6.2 Notifikasi

Notifikasi adalah kotak masuk pengguna lintas grup.

| Endpoint | Fungsi |
|---|---|
| GET /api/notifications | Daftar, terbaru lebih dulu, berkursor (2.5). Query: unread=true, groupId. |
| GET /api/notifications/unread-count | { data: { count } } untuk lencana. |
| POST /api/notifications/:notificationId/read | Tandai satu dibaca. 204. Aman diulang. |
| POST /api/notifications/read-all | Tandai semua dibaca. Body opsional { groupId }. 204. |
| GET /api/me/notification-settings | { data: { notifyByEmail } } |
| PATCH /api/me/notification-settings | Body { notifyByEmail: boolean }. Mengembalikan pengaturan terbaru. |

Bentuk satu notifikasi:

    {
      "id": 501,
      "type": "APPROVAL_REQUEST",
      "groupId": 12,
      "payload": { "approvalId": 77, "transactionId": 1002, "amount": 70000, "requestedBy": { "id": 4, "name": "Rey" } },
      "readAt": null,
      "createdAt": "2026-10-10T08:30:00.000Z"
    }

Aturan: type adalah string. Klien mengabaikan type dan field payload yang tidak dikenal (agar tipe baru tidak merusak klien lama). Nilai teks di payload adalah data tak tepercaya dan dirender sebagai teks biasa (2.2). Nama pelaku pada entri dana disamarkan sesuai 2.8.

| type | Penerima | Isi payload |
|---|---|---|
| APPROVAL_REQUEST | Pemilih yang sah | approvalId, transactionId, amount, requestedBy |
| APPROVAL_DECIDED | Pengaju | approvalId, transactionId, outcome (APPROVED, REJECTED, EXPIRED) |
| CONSENT_REQUEST | Peserta transaksi subset, atau yang tanggungannya naik karena revisi | transactionId, amount (bagian peserta itu), requestedBy |
| REVISION_NOTICE | Semua anggota aktif | transactionId, revisionId, actor, at |
| ITEM_UNCLAIMED | Penalang | transactionId, itemIds |
| ITEM_OFFERED | Anggota yang ditunjuk | assignmentId, itemId, transactionId |
| HOLD_EXPIRING | Pemegang klaim | itemId, claimId, expiresAt |
| PAYMENT_REQUEST | Kreditur | paymentId, sender, amount |
| PAYMENT_DECIDED | Pengirim pelunasan | paymentId, status |
| REMINDER | Debitur | creditor, amount |

CONSENT_REQUEST menambah daftar tipe di architecture.md 6.4. Karena type berupa string, tidak ada perubahan skema.

Email opsional: bila notifyByEmail bernilai true, notifikasi bertipe APPROVAL_REQUEST, CONSENT_REQUEST, ITEM_OFFERED, PAYMENT_REQUEST, dan REMINDER juga dikirim lewat EmailOutbox. Kolom pilihannya User.notifyByEmail (K13, architecture.md 6.1).

### 6.3 Persetujuan (Approval)

| Endpoint | Fungsi |
|---|---|
| GET /api/groups/:groupId/approvals | Daftar berkursor. Query: status=OPEN, mine=true (hanya yang bisa saya putuskan dan belum saya pilih). |
| GET /api/groups/:groupId/approvals/:approvalId | Detail satu Approval. |
| POST /api/groups/:groupId/approvals/:approvalId/votes | Beri suara. Body { vote: "APPROVE" | "REJECT" }. Wajib Idempotency-Key. 201, mengembalikan Approval terbaru. |

Bentuk Approval:

    {
      "id": 77,
      "groupId": 12,
      "subjectType": "TRANSACTION",
      "subjectId": 1002,
      "rule": "MAJORITY",
      "status": "OPEN",
      "required": 3,
      "eligibleCount": 4,
      "approveCount": 1,
      "rejectCount": 0,
      "myVote": null,
      "canVote": true,
      "requestedBy": { "id": 4, "name": "Rey" },
      "subject": { "transactionId": 1002, "description": "Makan malam", "amount": 70000, "mode": "EQUAL_ALL", "receiptStatus": "FAILED" },
      "expiresAt": "2026-10-17T08:30:00.000Z",
      "decidedAt": null,
      "createdAt": "2026-10-10T08:30:00.000Z"
    }

Aturan:
- canVote dan myVote dihitung server. Klien tidak menurunkannya dari rule.
- Untuk aturan penentu tunggal (ADMIN_ANY, ADMIN_OTHER, FUND_HOLDER), satu suara langsung memutuskan: respons suara sudah berstatus APPROVED atau REJECTED.
- Untuk subjectType REVISION dan FUND_MARK, bentuk subject disesuaikan jenisnya dan didokumentasikan bersama modul revisi dan dana.
- Pengaju tidak dapat memberi suara (403 forbidden). Memilih dua kali: 409 already-voted. Approval yang bukan OPEN: 409 invalid-state.
- Approval kedaluwarsa dievaluasi saat dibaca atau diberi suara (architecture.md 6.4), sehingga status EXPIRED bisa muncul tepat saat dibuka.

### 6.4 Consent peserta (TransactionShare)

| Endpoint | Fungsi |
|---|---|
| POST /api/groups/:groupId/transactions/:transactionId/shares/me/consent | Body { decision: "ACCEPT" | "REJECT" }. Wajib Idempotency-Key. |

Respons 200: { data: { share: { userId, amount, consent, consentAt }, transaction: { id, status, version } } }, sehingga klien langsung tahu apakah transaksi sudah ACTIVE setelah consent ini.

Aturan:
- Berlaku bila consent share milik pemanggil masih PENDING, baik pada transaksi PENDING_APPROVAL (mode subset) maupun pada revisi yang menaikkan tanggungan (keputusan 4).
- Bukan peserta: 403 forbidden. Consent sudah diputuskan: 409 invalid-state.
- REJECT tidak membatalkan transaksi. Share peserta itu berstatus REJECTED dan penalang mengubah daftar peserta lewat revisi (architecture.md 7.1).

### 6.5 Ringkasan tugas saya

| Endpoint | Fungsi |
|---|---|
| GET /api/me/summary | { data: { unreadNotifications, approvalsToVote, sharesToConsent, paymentsToConfirm, itemsOffered } } untuk lencana beranda. Semua angka lintas grup. |

### 6.6 Event Socket.IO

Mengikuti aturan 3.3 (event memberi tahu, REST sumber kebenaran).

| Event | Room | Muatan |
|---|---|---|
| notification:created | user:<id> | { id, type, groupId, serverTime } |
| approval:updated | group:<id> | { approvalId, transactionId, status, serverTime } |
| transaction:updated | group:<id> | { transactionId, status, version, serverTime } |
| share:updated | user:<penalang> dan user:<peserta> | { transactionId, userId, consent, serverTime } |

Klien yang menerima event mengambil ulang objek terkait lewat REST, atau memperbarui lencana dengan GET /api/me/summary.

<!-- akhir-bagian-api-4 -->

## 7. Pemilihan item (mode ITEMIZED)

### 7.1 Konsep

- Kartu pilih item adalah Message dengan kind SYSTEM_CARD, cardType ITEM_PICK, dan cardRef berisi transactionId (architecture.md 6.6). Kartu hanya penanda. Datanya selalu dibaca dari endpoint di bawah sehingga kartu mutakhir.
- Kartu terbit hanya untuk transaksi mode ITEMIZED berstatus ACTIVE dengan struk VERIFIED, atau yang disetujui lewat aturan struk gagal AI (K9).
- Awalan rute di bagian ini: /api/groups/:groupId/transactions/:transactionId. Semua endpoint tulis wajib Idempotency-Key (2.6).
- Satu baris klaim per pengguna per item. Status baris: HOLDING (dipilih, belum Done) dan DONE. HOLDING dilepas otomatis setelah 12 jam, dengan pengingat pada jam ke-10.
- Belum ditetapkan di bagian ini: perilaku klaim saat admin merevisi item (versi ekstraksi baru). Ditulis di bagian revisi.

### 7.2 Perhitungan biaya

1. Biaya item (C_i) adalah subtotal item ditambah porsi proporsional dari service, pajak (bila eksklusif), dan dikurangi diskon. Pembagian antar item memakai largest remainder, tie-break id item menaik. Ongkir tidak masuk C_i.
2. Biaya per unit (unitCost) adalah floor(C_i / qty). Sisa rupiah item ditanggung penalang (K14, architecture.md).
3. Ongkir dibagi merata hanya kepada pengguna yang punya minimal satu unit DONE, ditulis saat finalisasi, dengan largest remainder dan tie-break userId menaik (G1, G4).

Contoh: Nasi Goreng 2 x Rp25.000, Es Teh 3 x Rp5.000, PPN eksklusif Rp6.500, ongkir Rp5.000, total Rp76.500.
- C Nasi Goreng Rp55.000 dan C Es Teh Rp16.500. Jumlahnya Rp71.500, ditambah ongkir Rp5.000 sama dengan Rp76.500.
- unitCost Nasi Goreng Rp27.500 dan Es Teh Rp5.500.
- Ongkir Rp5.000 untuk tiga pengklaim: Rp1.667, Rp1.667, dan Rp1.666 (total Rp5.000).
- Contoh sisa: C_i Rp10.001 dengan qty 3 menghasilkan unitCost Rp3.333, dan sisa Rp2 ditanggung penalang.

### 7.3 Membaca kartu

GET /api/groups/:groupId/transactions/:transactionId/items. Dapat dibaca semua anggota ACTIVE grup itu.

    {
      "data": {
        "transactionId": 1002,
        "phase": "CLAIMING",
        "extractionVersion": 1,
        "shipping": 5000,
        "offerableAt": "2026-10-11T08:30:00.000Z",
        "canClaim": true,
        "canOffer": false,
        "canFinalize": false,
        "items": [
          {
            "id": 31,
            "name": "Nasi Goreng",
            "qty": 2,
            "unitPrice": 25000,
            "unitCost": 27500,
            "claimedQty": 1,
            "remainingQty": 1,
            "claims": [{ "userId": 4, "name": "Rey", "qty": 1, "status": "DONE" }],
            "myClaim": { "qty": 1, "status": "DONE", "locked": false, "holdExpiresAt": null }
          },
          {
            "id": 32,
            "name": "Es Teh",
            "qty": 3,
            "unitPrice": 5000,
            "unitCost": 5500,
            "claimedQty": 2,
            "remainingQty": 1,
            "claims": [{ "userId": 5, "name": "Aqidatul", "qty": 2, "status": "HOLDING" }],
            "myClaim": null
          }
        ],
        "myTotals": { "items": 27500, "shipping": null }
      }
    }

Aturan:
- phase bernilai CLAIMING atau FINALIZED. Ongkir pada myTotals bernilai null sampai FINALIZED (K4).
- claimedQty menghitung unit HOLDING dan DONE. remainingQty adalah qty dikurangi claimedQty.
- canClaim, canOffer, dan canFinalize dihitung server (seperti canVote di 6.3). Klien tidak menurunkannya sendiri.
- offerableAt adalah 24 jam sejak kartu terbit. Sebelum itu penalang tidak dapat menunjuk anggota.
- Nama item berasal dari OCR dan merupakan data tak tepercaya. Klien merender sebagai teks biasa (2.2).
- Asumsi: daftar claims (siapa mengambil apa) terlihat oleh semua anggota ACTIVE, sesuai kartu di chat.

### 7.4 Memilih dan Done

| Endpoint | Fungsi |
|---|---|
| PUT .../claims/me | Body { items: [{ itemId, qty }] }. Berisi seluruh pilihan saya (penggantian penuh): item yang tidak tercantum dilepas. Atomik, semua berhasil atau tidak ada yang berubah. 200 dengan { data: { items: [{ id, claimedQty, remainingQty }], myClaims, myTotals } }. |
| POST .../claims/me/done | Mengubah semua baris HOLDING milik saya menjadi DONE dan menulis CHARGE. 200 dengan { data: { myClaims, myTotals, phase } }. |

Aturan:
- qty bilangan bulat dan tidak boleh melebihi unit yang tersisa ditambah unit yang sudah saya pegang. Jika tidak cukup, 409 item-unavailable dengan errors berisi item yang gagal. Dua orang berebut unit terakhir: tepat satu berhasil (UPDATE bersyarat di architecture.md 6.3), yang lain mendapat 409.
- Mengubah baris HOLDING tidak menulis ledger.
- Mengubah atau melepas baris yang sudah DONE ditulis sebagai REVERSAL ditambah CHARGE baru (K5). Perubahan jumlah tetap berstatus DONE. Melepas sampai qty 0 menjadi RELEASED. Jika terkunci oleh pelunasan terkonfirmasi (K2): 409 claim-locked.
- Done tanpa baris HOLDING: 409 invalid-state.
- Jika Done ini membuat semua unit berstatus DONE, finalisasi terjadi pada panggilan yang sama: ongkir ditulis dan phase menjadi FINALIZED.
- Transaksi bukan ACTIVE atau phase sudah FINALIZED: 409 invalid-state.

### 7.5 Item belum terpilih dan finalisasi

| Endpoint | Fungsi |
|---|---|
| POST /api/groups/:groupId/transactions/:transactionId/items/:itemId/assignments | Hanya penalang. Body { assigneeIds: [4, 5], qty: 1 }. Hanya setelah offerableAt dan bila remainingQty cukup. 201 dengan { data: [ ...assignments ] }. Satu panggilan membuat satu offerGroupId. |
| POST /api/groups/:groupId/assignments/:assignmentId/respond | Hanya yang ditunjuk. Body { decision: "ACCEPT" | "REJECT" }. |
| POST /api/groups/:groupId/transactions/:transactionId/finalize | Hanya penalang. |

Aturan:
- ACCEPT bersifat atomik. Penerima pertama mendapat unit itu (klaim DONE dan CHARGE). Penunjukan lain dalam offerGroupId yang sama menjadi CANCELLED (keputusan 6). Menjawab penunjukan yang tidak lagi OFFERED: 409 invalid-state. Unit sudah diambil orang lain: 409 item-unavailable.
- finalize hanya setelah offerableAt, tanpa baris HOLDING dan tanpa penunjukan OFFERED yang menggantung. Unit yang belum diklaim menjadi bagian penalang sendiri (tidak menjadi utang), lalu ongkir ditulis (K16). Jika syarat belum terpenuhi: 409 invalid-state dengan detail penghalangnya.
- Finalisasi juga terjadi otomatis saat semua unit DONE (7.4).
- Pada offerableAt, penalang menerima notifikasi ITEM_UNCLAIMED (6.2). Yang ditunjuk menerima ITEM_OFFERED.

### 7.6 Event Socket.IO

| Event | Room | Muatan |
|---|---|---|
| item:updated | group:<id> | { transactionId, itemId, claimedQty, remainingQty, serverTime } |
| items:phase | group:<id> | { transactionId, phase, serverTime } |

item:updated dikirim pada setiap perubahan jumlah unit (HOLDING, DONE, RELEASED), termasuk pelepasan otomatis setelah 12 jam. Klien memperbarui angka yang tampil dari muatan itu, dan mengambil ulang GET .../items bila angkanya tidak cocok atau setelah koneksi terputus (3.3).

### 7.7 Kode error tambahan

| code | Status | Arti |
|---|---|---|
| claim-locked | 409 | Klaim DONE terkunci oleh pelunasan terkonfirmasi untuk pasangan pengutang-penalang (K2). |

<!-- akhir-bagian-api-5 -->
