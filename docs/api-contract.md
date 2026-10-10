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

Alasan keputusan (field decision.reason pada verifikasi struk). Nilai lama dipertahankan dan tiga nilai baru ditambahkan.

| reason | receiptStatus | Arti |
|---|---|---|
| ok | VERIFIED | Struk valid dan total sama dengan nominal transaksi. |
| not-a-receipt | FAILED | Gambar bukan struk. |
| low-confidence | FAILED | Keyakinan di bawah ambang 0,6 (MIN_CONFIDENCE). |
| total-unreadable | FAILED | Total pada struk tidak terbaca. |
| total-mismatch | FAILED | Total struk tidak sama dengan nominal transaksi. |
| tax-mode-unknown | NEEDS_REVIEW | PPN tidak dapat dipastikan eksklusif atau inklusif. Baru. |
| arithmetic-mismatch | NEEDS_REVIEW | Item ditambah service, pajak (bila eksklusif), dan ongkir dikurangi diskon tidak sama dengan total. Baru. |
| possible-duplicate | NEEDS_REVIEW | Isi mirip struk lain di grup yang sama (merchant, tanggal, total, jam). Perlu keputusan admin (K8). Baru. |

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
| ITEMS_CLOSED | Pemegang klaim yang dilepas saat penalang menutup | transactionId, closedBy, releasedItems |
| JOIN_REQUEST | Semua admin | requestId, user |
| GROUP_INVITE | Penerima undangan | invitationId, group, invitedBy |
| MEMBERSHIP_CHANGED | Pengguna yang bersangkutan | groupId, change (JOINED, REJECTED, REMOVED, ROLE_CHANGED), role |

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
- offerableAt adalah 24 jam sejak kartu terbit, saat penalang menerima notifikasi ITEM_UNCLAIMED. Penalang dapat menunjuk anggota kapan saja selama masih ada unit tersisa (K17).
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
| POST /api/groups/:groupId/transactions/:transactionId/items/:itemId/assignments | Hanya penalang. Body { assigneeIds: [4, 5], qty: 1 }. Kapan saja selama remainingQty cukup (K17). 201 dengan { data: [ ...assignments ] }. Satu panggilan membuat satu offerGroupId. |
| POST /api/groups/:groupId/assignments/:assignmentId/respond | Hanya yang ditunjuk. Body { decision: "ACCEPT" | "REJECT" }. |
| POST /api/groups/:groupId/transactions/:transactionId/finalize | Hanya penalang. |

Aturan:
- ACCEPT bersifat atomik. Penerima pertama mendapat unit itu (klaim DONE dan CHARGE). Penunjukan lain dalam offerGroupId yang sama menjadi CANCELLED (keputusan 6). Menjawab penunjukan yang tidak lagi OFFERED: 409 invalid-state. Unit sudah diambil orang lain: 409 item-unavailable.
- finalize oleh penalang dapat dilakukan kapan saja selama phase CLAIMING (K18, bagian 7.8).
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

### 7.8 Penutupan oleh penalang dan koreksi (mengubah 7.3 sampai 7.5)

Perubahan dari keputusan K17 dan K18 (architecture.md bagian 10):
- Penunjukan anggota oleh penalang tidak lagi menunggu offerableAt. Penunjukan tidak mencadangkan unit: yang lebih dulu berhasil memegang unit menang, dan penunjukan yang kalah mendapat 409 item-unavailable.
- finalize dapat dilakukan penalang kapan saja selama phase CLAIMING. Akibatnya, dalam satu transaksi database: baris HOLDING dilepas, penunjukan OFFERED menjadi CANCELLED, unit yang belum diklaim tidak menghasilkan utang, dan ongkir ditulis. phase menjadi FINALIZED, dengan finalizedAt dan finalizedBy pada transaksi.
- Pemegang HOLDING yang dilepas menerima notifikasi ITEMS_CLOSED.
- Tidak ada endpoint membuka kembali. Setelah FINALIZED, PUT .../claims/me dan POST .../claims/me/done menghasilkan 409 invalid-state. Koreksi klaim dilakukan lewat revisi (bagian revisi): perubahan ditulis REVERSAL ditambah CHARGE baru, anggota yang tanggungannya naik wajib setuju ulang, dan klaim yang terkunci (claim-locked) tidak dapat diubah.
- canFinalize bernilai true bagi penalang selama phase CLAIMING.

Endpoint tambahan:

| Endpoint | Fungsi |
|---|---|
| POST /api/groups/:groupId/assignments/:assignmentId/cancel | Membatalkan penunjukan yang masih OFFERED. Boleh oleh penalang yang menunjuk, atau admin. Body { reason } wajib untuk admin dan opsional untuk penalang. Wajib Idempotency-Key. 200 dengan assignment terbaru. Penunjukan yang sudah diputuskan: 409 invalid-state. |

Admin tidak memiliki endpoint untuk menetapkan item kepada anggota tanpa persetujuan orang itu (K17).

## 8. Riwayat pergerakan

### 8.1 Aturan

- Setiap aksi tulis oleh pengguna atau sistem tercatat sebagai satu baris AuditLog dalam transaksi yang sama (architecture.md K19).
- Riwayat tidak dapat diubah atau dihapus lewat API.
- Semua anggota ACTIVE dapat membaca riwayat grupnya. Pelaku entri dana disamarkan (2.8). Mantan anggota hanya melihat baris yang terkait ledger miliknya.
- actor bernilai null bila aksi dilakukan sistem.

### 8.2 Membaca riwayat

GET /api/groups/:groupId/audit, berkursor (2.5), terbaru lebih dulu.

Query: entity, action, actorId, transactionId, from, to (ISO 8601), limit, cursor.

    {
      "data": [
        {
          "id": 9001,
          "groupId": 12,
          "transactionId": 1002,
          "actor": { "id": 4, "name": "Rey" },
          "entity": "ItemClaim",
          "entityId": 55,
          "action": "CLAIM_SET",
          "oldValue": null,
          "newValue": { "itemId": 31, "qty": 1, "status": "HOLDING" },
          "reason": null,
          "createdAt": "2026-10-10T08:35:00.000Z"
        }
      ],
      "page": { "nextCursor": "abc123", "hasMore": true }
    }

Daftar action awal (dilengkapi di bagian lain): CLAIM_SET, CLAIM_DONE, CLAIM_RELEASE, HOLD_EXPIRED, ASSIGNMENT_OFFER, ASSIGNMENT_ACCEPT, ASSIGNMENT_DECLINE, ASSIGNMENT_CANCEL, ITEMS_FINALIZE, REVISE, TAKEDOWN, OVERRIDE_LEAVE, ROLE_CHANGE, FUND_MARK. Klien mengabaikan action yang tidak dikenal.

Nilai oldValue, newValue, dan reason adalah data tak tepercaya dan dirender sebagai teks biasa (2.2).

<!-- akhir-bagian-api-6 -->

## 9. Transaksi, struk, dan revisi

### 9.1 Objek dan status

Awalan rute: /api/groups/:groupId/transactions. Semua endpoint tulis wajib Idempotency-Key (2.6).

Mode: EQUAL_ALL, EQUAL_SUBSET, CUSTOM, ITEMIZED (K21). Status: DRAFT, PENDING_APPROVAL, ACTIVE, REJECTED, EXPIRED, WITHDRAWN, TAKEN_DOWN. DRAFT hanya terlihat oleh penalang. REJECTED, EXPIRED, WITHDRAWN, dan TAKEN_DOWN adalah status akhir dan tetap tampil di riwayat.

    {
      "data": {
        "id": 1002,
        "groupId": 12,
        "description": "Makan malam",
        "amount": 70000,
        "mode": "EQUAL_SUBSET",
        "status": "PENDING_APPROVAL",
        "receiptStatus": "VERIFIED",
        "itemsPhase": null,
        "version": 1,
        "payer": { "id": 4, "name": "Rey" },
        "paidFromFund": false,
        "hasReceipt": true,
        "participantCount": 3,
        "participants": null,
        "myShare": { "amount": 23333, "consent": "PENDING" },
        "approval": null,
        "expiresAt": "2026-10-17T08:30:00.000Z",
        "createdAt": "2026-10-10T08:30:00.000Z"
      }
    }

Aturan:
- participants bernilai null bila pemanggil tidak berhak melihat daftarnya (9.5). myShare bernilai null bila pemanggil bukan peserta.
- itemsPhase hanya terisi pada mode ITEMIZED (CLAIMING atau FINALIZED).
- paidFromFund true menampilkan Dana Kelompok tanpa nama pemegang (2.8).
- Nama penalang, deskripsi, dan field teks lain adalah data tak tepercaya dan dirender sebagai teks biasa (2.2).

### 9.2 Membuat, mengubah, dan mengirim

| Endpoint | Fungsi |
|---|---|
| POST /api/groups/:groupId/transactions | Membuat transaksi berstatus DRAFT. 201. Penalang adalah pemanggil (payerId dari token, tidak dari body). |
| PATCH /api/groups/:groupId/transactions/:transactionId | Mengubah DRAFT milik penalang. Body sama seperti pembuatan, semua field opsional. Perubahan nominal membatalkan hasil verifikasi struk dan receiptStatus kembali PENDING. |
| DELETE /api/groups/:groupId/transactions/:transactionId | Menghapus DRAFT milik penalang. 204. Selain DRAFT: 409 invalid-state. |
| POST /api/groups/:groupId/transactions/:transactionId/submit | Mengirim DRAFT dan menjalankan pemilihan jalur (architecture.md 7.2). 200 dengan { data: { transaction, approval } }. Approval bernilai null bila tidak ada. |

Body pembuatan:

    {
      "description": "Makan malam",
      "amount": 70000,
      "mode": "EQUAL_SUBSET",
      "participants": [{ "userId": 4 }, { "userId": 5 }, { "userId": 6 }]
    }

- EQUAL_ALL: participants tidak dikirim. Server memakai semua anggota ACTIVE pada saat submit.
- EQUAL_SUBSET: daftar userId peserta. Penalang boleh menjadi peserta.
- CUSTOM: daftar { userId, amount }. Jumlah semua amount harus sama dengan total.
- ITEMIZED: tidak ada peserta. Hanya diperbolehkan dengan struk (K9).
- Batas nominal Rp100.000.000 per transaksi (architecture.md 6.1). Pelanggaran: 400 validation-failed.

Pembagian rata memakai largest remainder dengan tie-break userId menaik (G4), menggantikan aturan lama di splitMoney.js (sisa ke peserta awal). Contoh: Rp70.000 untuk peserta 4, 5, 6 menjadi Rp23.334, Rp23.333, Rp23.333 (total Rp70.000). Bagian penalang sendiri bukan utang: hanya peserta 5 dan 6 yang berutang Rp23.333 kepada pengguna 4.

Submit:
- Hanya penalang, hanya dari DRAFT. Lainnya: 403 forbidden atau 409 invalid-state.
- ITEMIZED tanpa struk: 400 validation-failed. Struk sudah diunggah tetapi belum diverifikasi: 409 invalid-state dengan detail "verifikasi struk belum dijalankan".
- Hasil submit menurut tabel 7.2: ACTIVE (CHARGE ditulis) atau PENDING_APPROVAL (dengan Approval bila ada, dan consent peserta bila subset atau CUSTOM). Pada mode ITEMIZED yang ACTIVE, kartu pilih item terbit (bagian 7).
- Grup tanpa pemilih: ACTIVE langsung, dan satu baris riwayat dicatat (keputusan 2).

### 9.3 Struk

| Endpoint | Fungsi |
|---|---|
| POST .../transactions/:transactionId/receipt | Sudah ada. Hanya penalang, hanya saat DRAFT. Maks 5 MB, tipe dari byte awal. |
| POST .../transactions/:transactionId/receipt/verify | Sudah ada. Hanya penalang, hanya saat DRAFT. Respons mengikuti 5.3 dan 5.4. |

Tambahan:
- Hash SHA-256 gambar identik dengan struk pada transaksi ACTIVE atau PENDING_APPROVAL di grup yang sama: 409 duplicate-receipt dengan field tambahan existingTransactionId. Struk dari transaksi yang REJECTED, EXPIRED, WITHDRAWN, atau TAKEN_DOWN boleh dipakai ulang. Cakupan hanya satu grup (K8).
- Isi mirip (merchant, tanggal, total, dan jam) menghasilkan receiptStatus NEEDS_REVIEW dengan decision.reason possible-duplicate dan field warnings berisi existingTransactionId. Transaksinya masuk jalur Approval admin saat submit (K20).
- Ekstraksi hasil verifikasi dibaca lewat GET .../transactions/:transactionId/extraction (anggota ACTIVE). Bentuknya mengikuti ReceiptExtraction (architecture.md 6.3) dan ditulis rinci setelah kontrak AI dengan Bintang disepakati.

### 9.4 Daftar dan riwayat

| Endpoint | Fungsi |
|---|---|
| GET /api/groups/:groupId/transactions | Daftar berkursor (2.5). Query: month (YYYY-MM, zona Asia/Jakarta, K24), status, mode, payerId, limit, cursor. DRAFT tidak muncul kecuali status=DRAFT, dan itu hanya milik pemanggil. |
| GET /api/groups/:groupId/transactions/:transactionId | Detail satu transaksi. |
| GET /api/me/history | Riwayat pribadi lintas grup, dari ledger. Query: month, groupId, counterpartyId, limit, cursor. |

Entri riwayat pribadi:

    {
      "id": 7001,
      "kind": "CHARGE",
      "direction": "I_OWE",
      "amount": 23333,
      "group": { "id": 12, "name": "Kos Melati" },
      "transactionId": 1002,
      "counterparty": { "id": 4, "name": "Rey" },
      "createdAt": "2026-10-10T08:40:00.000Z"
    }

- kind bernilai CHARGE, REVERSAL, atau SETTLEMENT. direction bernilai I_OWE atau OWED_TO_ME. amount selalu positif.
- Dana kelompok tampil sebagai Dana Kelompok tanpa id pemegang (2.8).
- Mantan anggota hanya melihat entri ledger miliknya (keputusan 7).
- Bulan dihitung dari Transaction.createdAt (K24).

### 9.5 Siapa melihat daftar peserta (K23)

| Keadaan | Penalang dan admin | Peserta | Anggota lain |
|---|---|---|---|
| Belum ACTIVE | Daftar lengkap dan status consent | Bagian sendiri, jumlah peserta | Jumlah peserta |
| ACTIVE | Daftar lengkap | Daftar lengkap | Daftar lengkap |

Server mengisi participants dan myShare sesuai tabel ini. Klien tidak menurunkannya sendiri.

### 9.6 Revisi

| Endpoint | Fungsi |
|---|---|
| POST .../transactions/:transactionId/revisions | Mengajukan revisi. |
| GET .../transactions/:transactionId/revisions | Daftar revisi berkursor, memuat nilai lama dan baru. Anggota ACTIVE. |

Body:

    {
      "baseVersion": 1,
      "reason": "Total di struk ternyata Rp76.000",
      "changes": {
        "amount": 76000,
        "participants": [{ "userId": 4 }, { "userId": 5 }, { "userId": 6 }]
      }
    }

- reason dan baseVersion wajib. baseVersion tidak sama dengan versi terbaru: 409 version-conflict (2.7).
- changes dapat memuat amount, description, participants, dan extraction (bentuknya mengikuti 9.3). Mengubah mode tidak diperbolehkan.
- Hanya pada transaksi ACTIVE. Siapa boleh dan jalurnya mengikuti architecture.md 6.4: admin langsung berlaku (APPLIED), kecuali menyentuh tanggungannya sendiri (K6), atau admin sekaligus penalang, yang masuk Approval (ADMIN_OTHER, atau QUORUM_20 bila admin tunggal). Penalang non-admin hanya lewat Approval ADMIN_ANY.
- Respons 201 berisi revisi dengan status APPLIED atau PENDING_APPROVAL (disertai approval).
- Anggota yang tanggungannya naik menerima CONSENT_REQUEST dan harus setuju ulang (keputusan 4). Penurunan langsung berlaku. Kenaikan yang ditolak atau kedaluwarsa ditanggung penalang (K22).
- Semua anggota menerima REVISION_NOTICE (6.2).
- Pada ITEMIZED, revisi yang mengubah item memengaruhi klaim yang sudah DONE. Perilakunya ditulis bersama bentuk ekstraksi setelah kontrak AI disepakati.

Revisi:

    {
      "data": {
        "id": 301,
        "transactionId": 1002,
        "status": "APPLIED",
        "baseVersion": 1,
        "reason": "Total di struk ternyata Rp76.000",
        "requestedBy": { "id": 3, "name": "Admin" },
        "approval": null,
        "oldValue": { "amount": 70000 },
        "newValue": { "amount": 76000 },
        "createdAt": "2026-10-10T09:00:00.000Z",
        "appliedAt": "2026-10-10T09:00:00.000Z"
      }
    }

Contoh: Rp70.000 menjadi Rp76.000 untuk tiga peserta. Bagian baru Rp25.334, Rp25.333, dan Rp25.333 (total Rp76.000). Kenaikan per orang Rp2.000.

### 9.7 Penarikan dan takedown

| Endpoint | Fungsi |
|---|---|
| POST .../transactions/:transactionId/withdraw | Penalang menarik pengajuannya selama PENDING_APPROVAL. Status menjadi WITHDRAWN, Approval menjadi CANCELLED, consent tertunda gugur. 200 dengan transaksi terbaru. |
| POST .../transactions/:transactionId/takedown | Admin menurunkan transaksi ACTIVE. Body { reason, baseVersion }, keduanya wajib. |

- Takedown mengubah status menjadi TAKEN_DOWN, membalik semua CHARGE terkait lewat REVERSAL, dan mengubah klaim item menjadi VOIDED (G5). Kelebihan bayar menjadi kredit ke pembayarnya (architecture.md 7.3).
- Takedown oleh admin yang memiliki tanggungan pada transaksi itu mengurangi tanggungannya sendiri (K6). Respons 202 berisi { data: { approval } } dan transaksi baru diturunkan setelah admin lain menyetujui, atau lewat QUORUM_20 bila admin tunggal.
- Transaksi bukan ACTIVE: 409 invalid-state.

### 9.8 Kode error dan event

| code | Status | Arti |
|---|---|---|
| duplicate-receipt | 409 | Gambar sama dengan struk transaksi aktif di grup. Berisi existingTransactionId. |

Kode yang sudah ada dipakai untuk kondisi lain: version-conflict, invalid-state, forbidden, validation-failed, payload-too-large, dan unsupported-media-type.

Event: memakai transaction:updated, approval:updated, dan notification:created (6.6). Tidak ada event untuk DRAFT. share:updated hanya ke user:<penalang> dan user:<peserta> (K23).

<!-- akhir-bagian-api-7 -->

## 10. Pembayaran dan saldo

### 10.1 Konsep

- Saldo selalu dihitung dari LedgerEntry dan tidak disimpan (architecture.md 6.2 dan K25). Pihak ledger adalah pengguna atau Dana Kelompok. Dana tampil sebagai Dana Kelompok tanpa id pemegang (2.8).
- Saldo pasangan dihitung per pasangan tak berurut: yang ditanggung A kepada B dikurangi yang ditanggung B kepada A. API menyajikannya dari sudut pandang anggota yang diminta.
- Semua anggota ACTIVE melihat saldo grup dan rincian tiap anggota. Mantan anggota hanya melihat pasangan miliknya (keputusan 7).
- Mantan anggota tetap dapat mengirim dan mengonfirmasi pelunasan selama saldonya tidak nol. Tidak ada akses chat.
- Pelunasan dicatat per pasangan pengutang dan kreditur, bukan per transaksi (keputusan 10). Semua pelunasan bilateral. Tidak ada rekomendasi multilateral (K3).
- Semua endpoint tulis di bagian ini wajib Idempotency-Key (2.6).

### 10.2 Membaca saldo

| Endpoint | Fungsi |
|---|---|
| GET /api/groups/:groupId/balances | Ringkasan semua anggota grup. Anggota ACTIVE. |
| GET /api/groups/:groupId/balances/:userId | Rincian satu anggota ke tiap pihak. Nilai :userId boleh fund untuk Dana Kelompok. |
| GET /api/me/balances | Ringkasan saya per grup, lintas grup. |

Ringkasan grup:

    {
      "data": {
        "members": [
          { "party": { "kind": "USER", "id": 4, "name": "Rey", "membership": "ACTIVE" }, "owes": 30000, "owed": 5000, "balance": -25000 },
          { "party": { "kind": "USER", "id": 5, "name": "Aqidatul", "membership": "ACTIVE" }, "owes": 10000, "owed": 30000, "balance": 20000 },
          { "party": { "kind": "USER", "id": 6, "name": "Bintang", "membership": "ACTIVE" }, "owes": 5000, "owed": 10000, "balance": 5000 }
        ]
      }
    }

- owes adalah total yang ditanggung anggota itu kepada pihak lain. owed adalah total yang ditanggung pihak lain kepadanya. balance adalah owed dikurangi owes (negatif berarti berutang secara bersih).
- Jumlah seluruh balance dalam satu grup selalu nol. Baris Dana Kelompok memakai kind FUND dan nama Dana Kelompok.
- Anggota LEFT atau REMOVED hanya muncul bila saldonya tidak nol (membership menjadi LEFT atau REMOVED, tampil sebagai mantan anggota).

Rincian satu anggota (X):

    {
      "data": {
        "party": { "kind": "USER", "id": 4, "name": "Rey", "membership": "ACTIVE" },
        "owes": 30000,
        "owed": 5000,
        "counterparties": [
          {
            "party": { "kind": "USER", "id": 5, "name": "Aqidatul", "membership": "ACTIVE" },
            "amount": 30000,
            "direction": "X_OWES",
            "breakdown": { "group": 10000, "individual": 40000, "settled": -20000 },
            "pendingPayments": 10000,
            "payable": 20000
          },
          {
            "party": { "kind": "USER", "id": 6, "name": "Bintang", "membership": "ACTIVE" },
            "amount": 5000,
            "direction": "X_IS_OWED",
            "breakdown": { "group": -5000, "individual": 0, "settled": 0 },
            "pendingPayments": 0,
            "payable": 0
          }
        ]
      }
    }

Aturan:
- amount selalu nol atau positif. direction bernilai X_OWES (X berutang kepada pihak itu), X_IS_OWED, atau SETTLED.
- breakdown ditulis dari sudut pandang X sebagai pengutang: nilai positif menambah utang X. group dan individual adalah jumlah CHARGE dan REVERSAL per kategori (GROUP untuk biaya merata, INDIVIDUAL untuk biaya per item). settled adalah jumlah pelunasan: pembayaran oleh X bernilai negatif, pembayaran oleh pihak lawan bernilai positif. Jumlah group, individual, dan settled menghasilkan angka bersih, dan amount adalah nilai mutlaknya.
- pendingPayments dan payable hanya terisi bila X adalah pemanggil, selain itu null. pendingPayments adalah total pelunasan PENDING dari pemanggil kepada pihak itu. payable adalah amount dikurangi pendingPayments (nol bila direction bukan X_OWES). Dari contoh: 30000 dikurangi 10000 menghasilkan 20000.
- Hanya pihak dengan saldo tidak nol yang ditampilkan, diurutkan dari amount terbesar.
- Baris ledger di balik angka ini dibaca lewat GET /api/me/history dengan query groupId dan counterpartyId (9.4). Pemanggil hanya dapat membaca baris miliknya sendiri.

Ringkasan saya lintas grup:

    {
      "data": {
        "totals": { "owes": 30000, "owed": 5000, "balance": -25000 },
        "groups": [
          { "group": { "id": 12, "name": "Kos Melati" }, "owes": 30000, "owed": 5000, "balance": -25000 }
        ]
      }
    }

### 10.3 Metode pembayaran

Metode milik pengguna sendiri:

| Endpoint | Fungsi |
|---|---|
| GET /api/me/payment-methods | Daftar metode saya (aktif dan nonaktif). |
| POST /api/me/payment-methods | Menambah metode. Body { kind, provider, accountNo, accountName }. Untuk kind CASH, hanya kind yang dikirim. 201. |
| PATCH /api/me/payment-methods/:methodId | Mengubah provider, accountNo, atau accountName. |
| DELETE /api/me/payment-methods/:methodId | Menonaktifkan metode. 204. Menonaktifkan metode aktif terakhir: 409 last-payment-method. |

Metode:

    { "id": 21, "kind": "EWALLET", "provider": "Dana", "accountName": "Aqidatul I.", "accountNo": "081200000000", "isActive": true }

Aturan:
- kind bernilai BANK, EWALLET, atau CASH. Untuk BANK dan EWALLET, provider, accountNo, dan accountName wajib. Batas panjang dan format divalidasi dengan zod (nilainya ditetapkan saat implementasi).
- accountNo disimpan terenkripsi (architecture.md 6.5) dan tidak pernah masuk konteks chatbot.
- Metode yang dinonaktifkan tidak dihapus (riwayat pelunasan masih merujuknya).
- Minimal satu metode aktif ditegakkan saat penalang mengirim transaksi: 409 payment-method-required (K26). Pengguna yang menolak tunai cukup tidak memiliki metode CASH.

Metode pihak lain dan pengaturan grup:

| Endpoint | Fungsi |
|---|---|
| GET /api/groups/:groupId/members/:userId/payment-methods | Metode aktif milik anggota, hanya jenis yang diizinkan grup. |
| GET /api/groups/:groupId/payment-settings | { data: { allowedKinds: [] } }. Daftar kosong berarti semua jenis. Semua anggota ACTIVE. |
| PUT /api/groups/:groupId/payment-settings | Body { allowedKinds: ["BANK", "EWALLET"] }. Hanya admin. |

- Nomor rekening hanya dibuka bila pemanggil adalah pemilik, atau pemanggil berutang kepada pemilik (direction X_OWES pada rincian 10.2, termasuk mantan anggota). Selain itu 403 forbidden.
- Pemegang dana boleh melihat metode kreditur bila dana berutang kepada kreditur itu, sebagai pelunasan atas nama dana (architecture.md 6.5 dan 8.1).

### 10.4 Pelunasan

| Endpoint | Fungsi |
|---|---|
| POST /api/groups/:groupId/payments | Mengirim pelunasan (multipart/form-data). 201. |
| GET /api/groups/:groupId/payments | Daftar pelunasan saya (dikirim dan diterima), berkursor (2.5). Query: role (sent atau received), status, limit, cursor. |
| GET /api/groups/:groupId/payments/:paymentId | Detail. Hanya pengirim dan penerima. |
| POST /api/groups/:groupId/payments/:paymentId/confirm | Penerima mengonfirmasi. Menulis SETTLEMENT. |
| POST /api/groups/:groupId/payments/:paymentId/reject | Penerima menolak. Body opsional { reason }. |
| POST /api/groups/:groupId/payments/:paymentId/cancel | Pengirim membatalkan selama PENDING. |
| GET /api/groups/:groupId/payments/:paymentId/proof | Mengalirkan gambar bukti. Hanya pengirim dan penerima. |

Body pembuatan (multipart/form-data):

| Field | Keterangan |
|---|---|
| receiverId | Wajib. Id pengguna penerima. |
| amount | Wajib. Bilangan bulat positif. Tidak boleh melebihi payable (10.2). |
| methodType | Wajib. BANK, EWALLET, atau CASH. |
| methodId | Wajib untuk BANK dan EWALLET: salah satu metode aktif milik penerima. |
| note | Opsional. |
| onBehalfOfFund | Opsional, bernilai true hanya untuk pemegang dana. Pelunasan atas nama Dana Kelompok. |
| proof | Berkas gambar. Wajib kecuali methodType CASH. Maksimal 5 MB. Tipe divalidasi dari byte awal (JPEG, PNG, atau WebP). Disimpan di container proofs. |

Objek pelunasan:

    {
      "data": {
        "id": 801,
        "groupId": 12,
        "sender": { "kind": "USER", "id": 4, "name": "Rey" },
        "receiver": { "kind": "USER", "id": 5, "name": "Aqidatul" },
        "amount": 10000,
        "methodType": "EWALLET",
        "method": { "id": 21, "provider": "Dana", "accountName": "Aqidatul I." },
        "note": null,
        "hasProof": true,
        "status": "PENDING",
        "rejectReason": null,
        "createdAt": "2026-10-10T09:00:00.000Z",
        "decidedAt": null,
        "cancelledAt": null
      }
    }

Aturan:
- Status mengikuti architecture.md 7.3: PENDING, lalu CONFIRMED, REJECTED, atau CANCELLED.
- Nominal tidak boleh melebihi payable saat pengajuan, dan diperiksa ulang saat konfirmasi (K25). Jika saldo berubah sehingga nominal melebihi sisa utang: 409 amount-exceeds-debt. Penerima menolak, atau pengirim membatalkan lalu mengajukan ulang. Contoh: saldo 30000 dan pelunasan PENDING 10000. Pengajuan 25000 ditolak karena sisanya 20000.
- Bukti tidak ada untuk methodType selain CASH: 400 validation-failed. Berkas lebih dari 5 MB: 413 payload-too-large. Tipe tidak sesuai: 415 unsupported-media-type.
- Metode di luar jenis yang diizinkan grup, atau penerima tidak punya metode yang sesuai: 409 no-accepted-method (K26).
- Mengirim ke diri sendiri atau ke pihak yang tidak berutang: 400 invalid-receiver. Pihak lawan bukan pemilik saldo positif: 409 amount-exceeds-debt.
- Konfirmasi menulis satu LedgerEntry SETTLEMENT (sign negatif, debitur pengirim, kreditur penerima, paymentId terisi). Pada pelunasan atas nama dana, debitur adalah Dana Kelompok. Waktu konfirmasi menjadi acuan kunci pilihan item (K2).
- Pengirim yang bukan pemegang dana tidak boleh mengirim onBehalfOfFund: 403 forbidden.
- Penerima, pengirim, dan admin melihat nama pemegang dana pada pelunasan atas nama dana. Anggota lain melihat Dana Kelompok (architecture.md 8.1, pengecualian yang diterima).
- Mantan anggota boleh mengirim, mengonfirmasi, dan membaca pelunasannya sendiri.
- Berkas bukti dikirim dengan Cache-Control private dan no-store.

Batasan yang diterima: pelunasan PENDING tidak kedaluwarsa otomatis. Jika kreditur tidak merespons, pengirim hanya dapat membatalkan dan menyelesaikannya secara sosial. Tidak ada mediasi admin.

### 10.5 Pengingat

| Endpoint | Fungsi |
|---|---|
| POST /api/groups/:groupId/reminders | Body { debtorId }. Hanya kreditur yang memiliki saldo positif dari debitur itu. 201. |
| GET /api/groups/:groupId/reminders/status | Query debtorId. Untuk mengaktifkan atau menonaktifkan tombol di klien. |

Respons pengiriman:

    { "data": { "id": 61, "sentAt": "2026-10-10T09:00:00.000Z", "remaining": 2, "nextAllowedAt": "2026-10-10T21:00:00.000Z" } }

Status:

    { "data": { "count": 1, "remaining": 2, "nextAllowedAt": "2026-10-10T21:00:00.000Z", "canSend": false } }

Aturan:
- Jeda 12 jam dan maksimal tiga kali per siklus utang (architecture.md 4 dan K27). Dari contoh: pengingat pertama dikirim 09:00 UTC, sisa dua kali, dan berikutnya baru boleh pada 21:00 UTC.
- Dalam jeda: 429 reminder-cooldown dengan header Retry-After. Batas tiga kali tercapai: 409 reminder-limit. Tidak ada utang: 409 invalid-state.
- Penulisan Reminder, EmailOutbox, dan Notification REMINDER terjadi dalam satu transaksi database.
- Email dikirim atas nama aplikasi dan memuat nama kreditur, nama grup, dan nominal. Tidak memuat email kreditur maupun nomor rekening. Email tetap dikirim terlepas dari User.notifyByEmail (K27).
- Debitur mantan anggota yang masih berutang tetap dapat diingatkan.

### 10.6 Event dan kode error

| Event | Room | Muatan |
|---|---|---|
| balances:changed | group:<id> | { groupId, serverTime } |
| payment:updated | user:<pengirim> dan user:<penerima> | { paymentId, groupId, status, serverTime } |

Detail pelunasan bersifat pribadi sehingga tidak disiarkan ke seluruh grup. Klien memperbarui saldo dengan mengambil ulang endpoint 10.2 setelah menerima balances:changed.

| code | Status | Arti |
|---|---|---|
| payment-method-required | 409 | Penalang belum punya metode pembayaran aktif saat mengirim transaksi (K26). |
| last-payment-method | 409 | Tidak dapat menonaktifkan metode aktif terakhir. |
| no-accepted-method | 409 | Tidak ada irisan antara jenis yang diizinkan grup dan metode milik penerima. |
| reminder-cooldown | 429 | Pengingat dalam jeda 12 jam. Disertai Retry-After. |
| reminder-limit | 409 | Batas tiga pengingat per siklus utang tercapai. |

Kode yang sudah ada dipakai untuk kondisi lain: amount-exceeds-debt, invalid-receiver, invalid-state, forbidden, validation-failed, payload-too-large, dan unsupported-media-type.

### 10.7 Migrasi endpoint pelunasan dan saldo yang sudah berjalan

| Endpoint lama | Perubahan |
|---|---|
| POST /api/groups/:groupId/payments (JSON, receiverId dan amount) | Menjadi multipart dengan methodType, methodId, dan proof (10.4). |
| PATCH /api/groups/:groupId/payments/:paymentId | Diganti tiga endpoint aksi: confirm, reject, cancel. |
| GET /api/groups/:groupId/payments | Berkursor dengan filter role dan status (2.5). |
| GET /api/groups/:groupId/balances | Bentuk baru (10.2). suggestSettlements dihapus (K3). Saldo dihitung dari LedgerEntry. |

Koleksi Postman (docs/postman/build.mjs) diperbarui mengikuti perubahan di atas.

<!-- akhir-bagian-api-8 -->

## 11. Grup, anggota, dan peran

### 11.1 Konsep dan objek

- Awalan rute: /api/groups. Semua endpoint tulis di bagian ini wajib Idempotency-Key (2.6).
- Keanggotaan hanya ACTIVE, LEFT, dan REMOVED. Permintaan gabung dan undangan adalah objek terpisah (architecture.md K28).
- Hanya anggota ACTIVE yang membaca isi grup. Mantan anggota hanya melihat ledger miliknya (10.1).
- Endpoint grup tidak pernah menampilkan email pengguna.
- Tidak ada penghapusan grup. Grup yang ditinggalkan semua anggotanya tetap ada karena ledger masih merujuknya.
- Database dev direset (G3), jadi tidak ada migrasi data peran lama.

Objek grup untuk anggota ACTIVE:

    {
      "data": {
        "id": 12,
        "name": "Kos Melati",
        "code": "K7M2QX",
        "codeHidden": false,
        "joinRequiresApproval": false,
        "myRole": "OWNER",
        "membership": "ACTIVE",
        "memberCount": 3,
        "memberLimit": 50,
        "createdAt": "2026-10-01T08:00:00.000Z"
      }
    }

Aturan:
- code bernilai null bila codeHidden true dan pemanggil MEMBER. Admin dan OWNER tetap melihat kode.
- Mantan anggota yang masih punya saldo menerima objek terbatas: { id, name, membership, myRole: null }, tanpa kode dan pengaturan.
- Nama grup adalah data tak tepercaya dan dirender sebagai teks biasa (2.2).
- Nilai kode pada contoh hanya ilustrasi.

### 11.2 Membuat, melihat, dan mengatur grup

| Endpoint | Fungsi |
|---|---|
| POST /api/groups | Body { name }. 201 dengan objek grup. Pembuat menjadi OWNER (architecture.md keputusan 1). |
| GET /api/groups | Daftar grup saya, tanpa page (jumlahnya kecil). |
| GET /api/groups/:groupId | Objek grup. |
| PATCH /api/groups/:groupId | Admin. Body { name, codeHidden, joinRequiresApproval }, semua opsional. Mengembalikan objek grup terbaru. |
| POST /api/groups/:groupId/code/rotate | Admin. Kode lama langsung tidak berlaku. 200 dengan { data: { code } }. |

Daftar grup saya:

    {
      "data": [
        { "id": 12, "name": "Kos Melati", "membership": "ACTIVE", "myRole": "OWNER", "memberCount": 3, "balance": -25000, "pendingJoinRequests": 2 },
        { "id": 15, "name": "KKN Desa", "membership": "LEFT", "myRole": null, "memberCount": null, "balance": 15000, "pendingJoinRequests": null }
      ]
    }

- balance adalah saldo bersih saya di grup itu: positif berarti orang lain berutang kepada saya (10.2). Pada contoh, Rp25.000 berutang di Kos Melati dan Rp15.000 dipiutangi di KKN Desa.
- Grup dengan membership LEFT atau REMOVED hanya muncul bila saldo tidak nol.
- pendingJoinRequests hanya terisi untuk admin dan OWNER, selain itu null.
- Panjang nama divalidasi dengan zod (nilainya ditetapkan saat implementasi).
- Mengubah nama atau pengaturan menulis satu baris riwayat (K19).

### 11.3 Bergabung dan permintaan gabung

| Endpoint | Fungsi |
|---|---|
| POST /api/groups/join | Body { code }. Wajib Idempotency-Key. |
| GET /api/me/join-requests | Permintaan gabung saya yang masih PENDING. |
| POST /api/me/join-requests/:requestId/cancel | Membatalkan permintaan saya. 204. |
| GET /api/groups/:groupId/join-requests | Admin. Berkursor (2.5). Query: status (bawaan PENDING). |
| POST /api/groups/:groupId/join-requests/:requestId/approve | Admin. Memasukkan pemohon sebagai ACTIVE. |
| POST /api/groups/:groupId/join-requests/:requestId/reject | Admin. 204. |

Hasil bergabung lewat kode:

| Keadaan | Respons |
|---|---|
| Kode benar, grup tanpa persetujuan, pemanggil bukan REMOVED | 200 { data: { outcome: "JOINED", group: { id, name }, requestId: null } } |
| Kode benar, joinRequiresApproval, atau pemanggil berstatus REMOVED | 202 { data: { outcome: "REQUESTED", group: { id, name }, requestId: 91 } } |
| Pemanggil punya undangan PENDING untuk grup itu | 200 dengan outcome JOINED. Undangan menjadi ACCEPTED. Jeda dan persetujuan tidak berlaku (K30). |

Kondisi gagal:

| Kondisi | Respons |
|---|---|
| Kode tidak dikenal atau sudah diputar | 404 not-found (tidak dibedakan) |
| Sudah menjadi anggota ACTIVE | 409 already-member |
| Sudah ada permintaan PENDING | 409 join-pending |
| Dalam jeda 24 jam | 429 join-cooldown dengan Retry-After |
| Grup sudah 50 anggota | 409 group-full |
| Lebih dari 10 percobaan dalam 15 menit | 429 rate-limited dengan Retry-After |

Objek permintaan gabung:

    { "id": 91, "user": { "id": 7, "name": "Dina" }, "status": "PENDING", "createdAt": "2026-10-10T09:00:00.000Z", "expiresAt": "2026-10-17T09:00:00.000Z", "decidedAt": null }

Aturan:
- Pemegang kode melihat nama grup sebelum disetujui. Ini pengecualian yang diterima.
- Untuk daftar milik saya (GET /api/me/join-requests), objek berisi group menggantikan user.
- Menyetujui permintaan yang sudah kedaluwarsa atau tidak lagi PENDING: 409 invalid-state. Grup penuh: 409 group-full.
- Menyetujui dan menolak menulis riwayat. Pemohon menerima notifikasi MEMBERSHIP_CHANGED (JOINED atau REJECTED) tanpa alasan. Admin menerima JOIN_REQUEST saat permintaan dibuat.
- Jeda 24 jam dihitung dari yang lebih akhir antara leftAt (REMOVED) dan decidedAt permintaan terakhir yang ditolak. Contoh: dikeluarkan 2026-10-10T08:00:00Z, boleh mengajukan lagi sejak 2026-10-11T08:00:00Z.
- Satu pemohon hanya punya satu permintaan PENDING per grup.

### 11.4 Undangan

| Endpoint | Fungsi |
|---|---|
| POST /api/groups/:groupId/invitations | Admin. Body { email }. Selalu 202 { data: { accepted: true } }. |
| GET /api/groups/:groupId/invitations | Admin. Undangan PENDING dengan email disamarkan. |
| DELETE /api/groups/:groupId/invitations/:invitationId | Admin membatalkan. 204. |
| GET /api/me/invitations | Undangan untuk email akun saya. |
| POST /api/me/invitations/:invitationId/accept | 200 dengan { data: { group: { id, name }, membership: "ACTIVE" } }. |
| POST /api/me/invitations/:invitationId/decline | 204. |

Aturan:
- Pembuatan undangan selalu 202, terlepas dari email terdaftar, sudah menjadi anggota, atau sudah diundang. Tujuannya mencegah pengujian email (architecture.md K29). Format email yang salah: 400 validation-failed. Undangan tertunda mencapai 20: 409 invitation-limit.
- Daftar admin menampilkan email dengan huruf pertama lalu tiga tanda bintang lalu domain, tanpa nama pemilik akun:

    { "id": 31, "email": "a***@gmail.com", "status": "PENDING", "createdAt": "2026-10-10T09:00:00.000Z", "expiresAt": "2026-10-17T09:00:00.000Z" }

- Daftar undangan penerima:

    { "id": 31, "group": { "id": 12, "name": "Kos Melati" }, "invitedBy": { "id": 4, "name": "Rey" }, "createdAt": "2026-10-10T09:00:00.000Z", "expiresAt": "2026-10-17T09:00:00.000Z" }

- Menerima undangan menggantikan persetujuan admin dan jeda 24 jam. Grup penuh: 409 group-full. Undangan yang kedaluwarsa atau sudah diputuskan: 409 invalid-state.
- Notifikasi GROUP_INVITE hanya dibuat bila akun dengan email itu sudah ada saat undangan dibuat. Yang mendaftar kemudian melihatnya lewat GET /api/me/invitations dalam tujuh hari. Tidak ada email keluar.

<!-- akhir-bagian-api-9a -->

### 11.5 Anggota, peran, dan kepemilikan

| Endpoint | Fungsi |
|---|---|
| GET /api/groups/:groupId/members | Anggota ACTIVE. Tanpa page (maksimal 50). |
| PUT /api/groups/:groupId/members/:userId/role | Hanya OWNER. Body { role: "ADMIN" atau "MEMBER" }. 200 dengan anggota terbaru. |
| POST /api/groups/:groupId/ownership/transfer | Hanya OWNER. Body { toUserId }. 200 dengan { data: { owner: { id, name } } }. |

Anggota:

    { "user": { "id": 4, "name": "Rey" }, "role": "OWNER", "joinedAt": "2026-10-01T08:00:00.000Z" }

Aturan:
- Daftar anggota tidak memuat email dan tidak menandai pemegang dana (architecture.md keputusan 9).
- Mengubah peran: sasaran harus ACTIVE, bukan OWNER, dan bukan diri sendiri. Pelanggaran: 409 invalid-state. Peran OWNER hanya berpindah lewat serah terima.
- Serah terima: sasaran harus ACTIVE dan berperan ADMIN, selain itu 409 invalid-state. Di dalam satu transaksi database, OWNER lama diturunkan menjadi ADMIN lebih dulu, baru sasaran dinaikkan menjadi OWNER. Urutan ini menjaga filtered unique index satu OWNER aktif per grup.
- Admin yang diturunkan kehilangan hak suara pada Approval berbasis admin yang masih terbuka. Hak suara diperiksa saat suara masuk (canVote, 6.3). eligibleCount tidak dihitung ulang (G2).
- Setiap perubahan menulis riwayat (ROLE_CHANGE, OWNERSHIP_TRANSFER) dan notifikasi MEMBERSHIP_CHANGED bertipe ROLE_CHANGED.

### 11.6 Keluar dan dikeluarkan

| Endpoint | Fungsi |
|---|---|
| POST /api/groups/:groupId/leave | Keluar sendiri. 204. |
| POST /api/groups/:groupId/members/:userId/remove | Admin atau OWNER. Body { reason, overrideBalance }. 204. |

Penghalang menghasilkan 409 dengan kode leave-blocked dan field blockers:

    {
      "type": "about:blank",
      "title": "Conflict",
      "status": 409,
      "code": "leave-blocked",
      "detail": "Tidak dapat keluar dari grup.",
      "blockers": [
        { "code": "OWNER" },
        { "code": "BALANCE", "owes": 30000, "owed": 5000 }
      ]
    }

| Penghalang | Dapat dilewati? |
|---|---|
| OWNER | Tidak. Serah terima dulu. |
| FUND_HOLDER | Tidak. Serahkan atau tutup dana dulu (architecture.md K10). |
| BALANCE (saldo tidak nol pada pasangan mana pun) | Hanya admin lewat remove dengan overrideBalance true dan reason wajib. Hasilnya REMOVED dan riwayat OVERRIDE_LEAVE. |

Aturan:
- Keluar sendiri dengan saldo tidak nol selalu diblokir. Anggota meminta admin untuk mengeluarkannya.
- Remove: pemanggil harus admin atau OWNER, selain itu 403 forbidden. Sasaran OWNER: 403 forbidden. Sasaran diri sendiri: 400 validation-failed (gunakan leave). Sasaran ADMIN: 409 invalid-state dengan detail turunkan dulu (K12 dan K31, berlaku juga bagi OWNER).
- reason wajib bila overrideBalance true, selain itu opsional. Alasan hanya masuk riwayat dan tidak dikirim ke orang yang dikeluarkan.
- Hasilnya membership LEFT (leave) atau REMOVED (remove). Ledger tidak berubah.
- Yang diselesaikan sistem otomatis (DRAFT dihapus, PENDING_APPROVAL ditarik, ITEMIZED CLAIMING difinalisasi, HOLDING dilepas, penunjukan dibatalkan, consent PENDING menjadi REJECTED) tercantum di architecture.md K31, masing-masing dengan baris riwayat actor null.
- Orang yang dikeluarkan menerima MEMBERSHIP_CHANGED (change REMOVED) tanpa alasan. Server mencabut koneksi socket-nya dari room grup (3.2).
- Mantan anggota tetap dapat membaca saldo dan mengelola pelunasan miliknya (10.1).

### 11.7 Event, notifikasi, dan kode error

| Event | Room | Muatan |
|---|---|---|
| member:updated | group:<id> | { groupId, userId, change (JOINED, LEFT, REMOVED, ROLE_CHANGED), serverTime } |
| group:updated | group:<id> | { groupId, serverTime } |

Permintaan gabung dan undangan tidak disiarkan ke grup. Admin menerima notification:created dengan tipe JOIN_REQUEST (6.2). Alasan pengeluaran tidak pernah ada di muatan event.

| code | Status | Arti |
|---|---|---|
| join-pending | 409 | Sudah ada permintaan gabung yang menunggu. |
| join-cooldown | 429 | Dalam jeda 24 jam. Disertai Retry-After. |
| group-full | 409 | Grup sudah 50 anggota ACTIVE. |
| invitation-limit | 409 | Undangan tertunda mencapai 20. |
| leave-blocked | 409 | Ada penghalang. Berisi blockers. |

Kode yang sudah ada dipakai untuk kondisi lain: not-found, already-member, forbidden, invalid-state, validation-failed, dan rate-limited.

Tipe action riwayat tambahan (melengkapi 8.2): JOIN_REQUEST, JOIN_APPROVE, JOIN_REJECT, JOIN_CANCEL, INVITE, INVITE_ACCEPT, INVITE_DECLINE, INVITE_CANCEL, MEMBER_JOIN, MEMBER_LEAVE, MEMBER_REMOVE, ROLE_CHANGE, OWNERSHIP_TRANSFER, CODE_ROTATE, GROUP_UPDATE.

### 11.8 Migrasi endpoint grup yang sudah berjalan

| Endpoint lama | Perubahan |
|---|---|
| POST /api/groups | Idempotency-Key wajib. Respons memakai objek 11.1. Pembuat menjadi OWNER. |
| POST /api/groups/join | Respons menjadi { outcome, group, requestId }. Kode salah menjadi not-found (sebelumnya group-not-found). Bisa 202 bila perlu persetujuan. Ada pembatas laju 10 percobaan per 15 menit per pengguna sejak Tahap 1. |
| GET /api/groups | Bentuk baru 11.2 dengan balance dan membership. |
| GET /api/groups/:id | Parameter menjadi :groupId. Respons objek 11.1. Mantan anggota dengan saldo mendapat objek terbatas. Selain itu yang bukan anggota ACTIVE mendapat 403 forbidden. |

Koleksi Postman (docs/postman/build.mjs) diperbarui mengikuti perubahan ini.

<!-- akhir-bagian-api-9 -->
