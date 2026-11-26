# PatunganKu

Aplikasi untuk mencatat, membagi, dan memverifikasi pengeluaran bersama dalam grup (kos, KKN, open trip). Foto struk diverifikasi AI sebelum nominalnya masuk tagihan. PatunganKu bukan payment gateway: aplikasi mencatat siapa berutang kepada siapa dan mengonfirmasi pelunasan, tetapi tidak memindahkan uang.

Senior Project, DTETI FT UGM, Kelompok 12 (Senior Project Jaringan Komputer, Komputasi Awan, dan AI).

## Rumusan masalah dan solusi

**Masalah.** Patungan di grup biasanya dicatat manual. Nominal sering dipertanyakan karena tidak ada bukti, dan setelah banyak transaksi sulit menentukan siapa masih berutang kepada siapa.

**Solusi.** Penalang mengunggah foto struk dan AI memeriksanya: apakah itu struk, apakah totalnya terbaca, apakah total sama dengan nominal yang diinput, dan apakah struk yang sama pernah dipakai. Nominal yang lolos dibagi ke anggota dengan pembulatan yang adil dan dicatat di buku besar (ledger) yang tidak bisa diubah. Saldo dihitung per pasangan anggota, dan pelunasan dikonfirmasi oleh penerimanya. Struk yang gagal diverifikasi tidak ditolak mentah-mentah, tetapi diputuskan anggota lewat persetujuan.

## Status per 24 November 2026

| Bagian | Status | Bukti |
| --- | --- | --- |
| Backend v2 | 39 endpoint berjalan (37 domain dan 2 kesehatan) | CI hijau pada commit `7c1f566`: 655 tes unit dan 134 tes integrasi di SQL Server 2022 asli |
| Verifikasi struk AI | Berjalan lewat Gemini API dengan ekstraksi minimal (struk atau bukan, total, keyakinan, nama toko, waktu) | Satu foto uji asap berhasil. Belum ada angka akurasi resmi, jadi tidak ada klaim akurasi di sini |
| Container | Dockerfile dan compose produksi terbukti berjalan lokal (build, health, berhenti bersih) | Dibuktikan di mesin pengembang, bukan di CI |
| Penyimpanan berkas | Unggah, baca, dan hapus terbukti terhadap Azurite (emulator lokal) | Belum diuji terhadap Azure Blob sungguhan |
| Azure | Belum ada sumber daya yang dibuat | Rencana jaringan dan deploy ada di `docs/deploy-azure.md` (draf) |
| Frontend | Prototype React dengan data contoh | Belum memanggil API backend sama sekali |
| Model YOLOv8 | Dikerjakan terpisah (AI Engineer) | Belum terintegrasi ke backend |

Backend v2 ada di branch `545518` (PR #54, draft). Branch `main` masih berisi backend v1 sebagai cadangan.

## Fitur yang berjalan (backend)

| Area | Endpoint (semua di bawah `/api`) |
| --- | --- |
| Kesehatan | `GET /health`, `GET /health/ready` |
| Akun | `POST /auth/register`, `POST /auth/login`, `GET` dan `PATCH /me`, `POST /me/password`, `GET /me/summary` |
| Grup | `POST /groups`, `GET /groups`, `POST /groups/join`, `GET /groups/:groupId`, `GET /groups/:groupId/members` |
| Transaksi | `POST` dan `GET /groups/:groupId/transactions`, `GET`, `PATCH`, `DELETE .../transactions/:transactionId`, `POST .../submit` |
| Struk | `POST .../transactions/:transactionId/receipt` (unggah), `POST .../receipt/verify` |
| Persetujuan | `GET .../approvals`, `GET .../approvals/:approvalId`, `POST .../approvals/:approvalId/votes` |
| Saldo | `GET /me/balances`, `GET /groups/:groupId/balances`, `GET .../balances/:userId` |
| Metode pembayaran | `GET` dan `POST /me/payment-methods`, `PATCH` dan `DELETE /me/payment-methods/:methodId`, `GET /groups/:groupId/members/:userId/payment-methods` |
| Pelunasan | `POST` dan `GET /groups/:groupId/payments`, `GET .../payments/:paymentId`, `GET .../proof`, `POST .../confirm`, `.../reject`, `.../cancel` |

Kontrak lengkap (isi permintaan, respons, kode galat) ada di `docs/api-contract.md`.

## Cara kerja inti

1. Anggota membuat grup lalu teman bergabung dengan kode grup (maksimal 50 anggota).
2. Penalang membuat draft transaksi, mengunggah foto struk, lalu memverifikasinya. Hasilnya `VERIFIED`, `NEEDS_REVIEW`, atau `FAILED` beserta alasannya.
3. Saat dikirim (submit), struk `VERIFIED` langsung menjadi transaksi aktif dan dibagi rata ke anggota aktif. Struk yang gagal masuk jalur persetujuan: pemilih menyetujui atau menolak, dengan kuorum yang dihitung dari jumlah pemilih.
4. Setiap pembagian ditulis ke ledger. Selisih pembulatan dibagi dengan metode sisa terbesar, misalnya Rp70.000 untuk 3 orang menjadi 23.334, 23.333, dan 23.333.
5. Saldo dihitung per pasangan anggota. Utang A ke B dan B ke A saling mengurangi.
6. Pengutang mengirim pelunasan (tunai, atau transfer dengan foto bukti). Penerima mengonfirmasi, dan baru saat itu saldo berkurang. Nominal pelunasan tidak boleh melebihi sisa utang.

Penalang wajib punya minimal satu metode pembayaran aktif sebelum bisa mengirim transaksi. Nomor rekening disimpan terenkripsi.

## Teknologi

| Bagian | Teknologi |
| --- | --- |
| Backend | Node.js (v22 atau lebih baru), Express 5, JavaScript ESM |
| Database | SQL Server 2022 lewat Prisma 7 (Docker untuk lokal, Azure SQL direncanakan) |
| Penyimpanan berkas | Azure Blob Storage (Azurite untuk lokal) |
| Verifikasi struk | Gemini API lewat REST |
| Validasi dan keamanan | zod, bcryptjs, jsonwebtoken (HS256), multer |
| Frontend | React 19, TypeScript, Vite, pnpm |
| Kontainer | Docker dan Docker Compose |
| CI | GitHub Actions (SQL Server sebagai service container) |

## Arsitektur backend

```
Klien -> app.js -> rute -> layanan -> Prisma -> SQL Server
                    |        |-> lib/blob.js (Azure Blob / Azurite)
                    |        |-> lib/pemverifGemini.js (Gemini API)
                    |-> middleware: requireAuth, requireMember, validate, idempoten
```

Beberapa keputusan desain yang dibuktikan tes:

- **Ledger tambah-saja.** Tabel `LedgerEntry`, `AuditLog`, dan `ReceiptExtraction` dilindungi trigger yang menolak UPDATE dan DELETE. Koreksi dilakukan dengan entri pembalik.
- **Uang berupa bilangan bulat rupiah.** Nominal ledger memakai BigInt dan pembagian memakai metode sisa terbesar, jadi total selalu persis.
- **Idempotensi.** Endpoint tulis memakai header `Idempotency-Key`. Permintaan yang diulang dengan kunci sama tidak menulis dua kali, dan kegagalan 409 membatalkan seluruh transaksi.
- **Kunci baris Group.** Pelunasan serentak untuk pasangan yang sama berjalan bergiliran, sehingga nominal tidak bisa melebihi utang.
- **Pemeriksaan konfigurasi.** Server menolak start di mode production bila CORS terbuka, koneksi tanpa enkripsi, atau kunci enkripsi nomor rekening belum diisi.

## Struktur repository

```
PatunganKu/
├── apps/
│   ├── backend/
│   │   ├── prisma/        # skema, migration (SQL Server)
│   │   ├── scripts/       # pemeriksa sintaks, penilai verifikasi struk
│   │   ├── src/
│   │   │   ├── config/    # env (divalidasi), konstanta
│   │   │   ├── lib/       # prisma, blob, pemverifikasi Gemini, shutdown
│   │   │   ├── middlewares/
│   │   │   ├── routes/    # pabrik router murni dan penyambungnya
│   │   │   ├── services/  # logika bisnis (pabrik murni, dependensi disuntik)
│   │   │   ├── utils/     # pembagian, saldo, idempotensi, audit, enkripsi
│   │   │   └── validators/
│   │   └── tests/         # unit (tanpa database) dan integrasi (SQL Server)
│   └── frontend/          # prototype React
├── docs/                  # arsitektur, kontrak API, roadmap, panduan demo, deploy
├── infra/                 # compose pengembangan dan produksi, Caddyfile, SQL akun aplikasi
├── site/                  # halaman GitHub Pages kelompok
└── .github/               # workflow CI, template issue dan PR
```

## Menjalankan di lokal

Backend v2 ada di branch `545518`. Panduan lengkap beserta pemecahan masalah ada di `apps/backend/SETUP.md`. Ringkasnya:

```bash
git clone https://github.com/ReyMindThink/PatunganKu.git
cd PatunganKu
git checkout 545518

cd infra
cp .env.example .env            # isi kata sandi kuat di infra/.env
docker compose up -d --wait     # SQL Server dan Azurite

cd ../apps/backend
npm install
cp .env.example .env            # isi kata sandi, JWT_SECRET, dan PAYMENT_ENC_KEY
# buat database patunganku_v2 lalu: npx prisma migrate deploy (lihat SETUP.md bagian 4)
npm run dev
curl http://localhost:4000/api/health
```

Prasyarat: Git, Node.js 22 atau lebih baru, Docker Desktop. Kunci Gemini diperlukan hanya untuk verifikasi struk.

## Tes dan CI

```bash
cd apps/backend
npm run check               # pemeriksaan sintaks semua berkas
npm test                    # 655 tes unit, tanpa database
npm run test:integration    # 134 tes di SQL Server (DB_NAME harus berakhiran _test)
```

Pada setiap push, GitHub Actions menjalankan pemeriksaan sintaks, tes unit, migrasi ke database kosong, pemeriksaan bahwa skema Prisma sama dengan migration, lalu tes integrasi di SQL Server 2022 asli. Tes integrasi tidak berjalan di CI untuk jalur Gemini dan Azure Blob: keduanya memakai pengganti di tes.

## Panduan demo

Langkah demo end-to-end (daftar, grup, struk, saldo, pelunasan) ada di `docs/panduan-demo.md`. Demo membutuhkan satu foto struk milik sendiri dan kunci Gemini.

## Dokumentasi

| Berkas | Isi |
| --- | --- |
| `docs/architecture.md` | Keputusan produk, ERD, aturan persetujuan, hak akses, koreksi desain |
| `docs/api-contract.md` | Kontrak API |
| `docs/roadmap.md` | Rencana tahap dan acceptance (status per issue ada di GitHub) |
| `docs/deploy-azure.md` | Rencana jaringan dan deploy Azure (draf, belum dijalankan) |
| `docs/frontend-brief.md` | Catatan untuk frontend |
| `docs/panduan-demo.md` | Panduan demo |
| `apps/backend/SETUP.md` | Setup backend dan pemecahan masalah |

Koleksi Postman di `docs/postman/` masih untuk backend v1 dan belum diperbarui.

## Keamanan

- Rahasia tidak ada di repository: `.env` diabaikan Git, compose menolak start tanpa kata sandi dari `infra/.env`, dan kata sandi lama yang pernah bocor sudah tidak berlaku.
- Kata sandi pengguna di-hash dengan bcrypt (batas 72 byte dihitung dalam byte UTF-8), token JWT HS256 berlaku 1 jam, dan percobaan masuk dibatasi lajunya.
- Nomor rekening dienkripsi AES-256-GCM dan terikat ke pemiliknya. Bukti pelunasan disimpan di container privat dan hanya dibaca lewat backend oleh pihak terkait.
- Akun aplikasi non-sa untuk database tersedia (`infra/sql/akun-app-azure.sql`) dan terbukti menjalankan 94 tes integrasi (jumlah saat diuji) tanpa hak DDL, tetapi belum dipakai di deploy.

Batas yang diketahui: tidak ada refresh token (token berlaku 1 jam tanpa pencabutan), pembatas laju hanya di memori satu instance, `npm audit` belum ditriase, dan riwayat Git publik masih memuat nilai kata sandi lama yang sudah dinonaktifkan.

## Yang sengaja tidak ada

Pembagian selain rata untuk semua anggota (subset, kustom, per item), dana kelompok, notifikasi dan email, chat, real-time (Socket.IO), peran admin tambahan dan undangan, serta refresh token. Semuanya direncanakan di tahap berikutnya pada `docs/roadmap.md` dan dipotong dari jalur minimum Senior Project. Verifikasi struk memakai Gemini sementara merangkap tahap deteksi yang semula direncanakan untuk YOLOv8.

## Anggota

| Nama | NIM | Peran |
| --- | --- | --- |
| Bintang Khalifa Hadianto (Ketua) | 24/534951/TK/59312 | AI Engineer, Software Engineer |
| Aqidatul Izzah | 24/533730/TK/59137 | UI/UX, Software Engineer |
| Rasyid Rayhan Novandy | 24/545518/TK/60688 | Cloud Engineer, Software Engineer |
