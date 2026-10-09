# PatunganKu

Aplikasi untuk mencatat, membagi, dan memverifikasi pengeluaran bersama dalam grup (kos, KKN, open trip). Foto struk diverifikasi oleh AI vision sebelum nominalnya masuk ke pembagian tagihan, dan riwayat disimpan di Azure.

Senior Project, DTETI FT UGM, Kelompok 12.

## Anggota

| Nama                             | NIM                | Peran                             |
| -------------------------------- | ------------------ | --------------------------------- |
| Bintang Khalifa Hadianto (Ketua) | 24/534951/TK/59312 | AI Engineer, Software Engineer    |
| Aqidatul Izzah                   | 24/533730/TK/59137 | UI/UX, Software Engineer          |
| Rasyid Rayhan Novandy            | 24/545518/TK/60688 | Cloud Engineer, Software Engineer |

## Status Pengembangan

| Bagian   | Status |
| -------- | ------ |
| Backend  | Struktur API sudah ada: auth, grup, transaksi, struk, saldo (ledger), dan pembayaran. |
| Frontend | Prototype web (React + TypeScript). Halaman masuk, beranda grup, dan form grup sudah ada, tetapi masih memakai data contoh (`mock.ts`) dan belum terhubung ke backend. |

## Teknologi

| Bagian            | Teknologi                |
| ----------------- | ------------------------ |
| Backend           | Node.js, Express, Prisma |
| Database          | Azure SQL Database       |
| Penyimpanan struk | Azure Blob Storage       |
| Verifikasi struk  | AI vision                |
| Frontend          | React + TypeScript, Vite |
| Kontainer         | Docker, Docker Compose   |
| CI/CD             | GitHub Actions           |

## Arsitektur

Request dari anggota grup masuk ke `app.js`, diteruskan ke route, lalu ke service yang berisi logika bisnis. Service mengakses database lewat Prisma. Untuk struk, `receipt.service.js` mengunggah gambar ke Azure Blob Storage dan meminta `receiptVerifier.js` memverifikasi gambar lewat layanan AI vision.

```
Anggota grup -> app.js -> routes -> services -> Prisma -> SQL database
                                        |-> blob.js (Azure Blob Storage)
                                        |-> receiptVerifier.js -> AI vision
```

| Resource    | Route                  | Service                  |
| ----------- | ---------------------- | ------------------------ |
| Auth        | `auth.routes.js`        | `auth.service.js`        |
| Grup        | `group.routes.js`       | `group.service.js`       |
| Transaksi   | `transaction.routes.js` | `transaction.service.js` |
| Struk       | `receipt.routes.js`     | `receipt.service.js`     |
| Saldo       | `ledger.routes.js`      | `ledger.service.js`      |
| Pembayaran  | `payment.routes.js`     | `payment.service.js`     |

## Struktur Repository

```
PatunganKU/
├── apps/
│   ├── backend/
│   │   ├── prisma/          # schema database dan migration
│   │   └── src/
│   │       ├── app.js       # aplikasi Express, mount semua route
│   │       ├── config/      # env loader, konstanta
│   │       ├── controllers/ # terima request, panggil service, bentuk response
│   │       ├── routes/      # endpoint per resource
│   │       ├── middlewares/ # auth, error handler, dll.
│   │       ├── services/    # logika bisnis (split bill, verifikasi struk, dll.)
│   │       ├── validators/  # skema validasi input request
│   │       ├── lib/         # prisma.js, blob.js, receiptVerifier.js
│   │       └── utils/       # helper umum
│   └── frontend/
│       └── src/
│           ├── main.tsx     # entry point
│           ├── App.tsx      # state routing antar halaman
│           ├── pages/       # AuthPage, HomePage, GroupFormPage
│           ├── components/  # AuthForm, Receipt, GroupRow, Button, Field, IconButton, Rings
│           ├── data/        # mock.ts (data contoh)
│           └── lib/         # format.ts (format mata uang)
├── docs/
│   └── postman/             # koleksi Postman untuk mencoba API
├── infra/                   # konfigurasi infrastruktur (Docker, Azure)
├── site/                    # halaman GitHub Pages kelompok
└── .github/                 # workflow CI/CD, template issue dan PR
```

## Menjalankan di Lokal

### Prasyarat

- [Git](https://git-scm.com/)
- [Node.js](https://nodejs.org/) LTS (disarankan v20 atau lebih baru) beserta npm
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (untuk database lokal)
- [Postman](https://www.postman.com/) (opsional, untuk mencoba API)

### 1. Clone repository

```bash
git clone https://github.com/ReyMindThink/PatunganKu.git
cd PatunganKu
```

### 2. Jalankan frontend (prototype)

Frontend tidak membutuhkan backend karena masih memakai data contoh, jadi bagian ini bisa dijalankan sendiri.

```bash
cd apps/frontend
npm install
npm run dev
```

Buka alamat yang tampil di terminal (biasanya `http://localhost:5173`).

<!-- TODO: cocokkan dengan "scripts" di apps/frontend/package.json -->

### 3. Jalankan backend

#### a. Siapkan database lokal

Backend memakai Azure SQL Database. Untuk pengembangan lokal, jalankan SQL Server di Docker:

```bash
docker run -d --name patunganku-db \
  -e "ACCEPT_EULA=Y" \
  -e "MSSQL_SA_PASSWORD=YourStrong!Passw0rd" \
  -p 1433:1433 \
  mcr.microsoft.com/mssql/server:2022-latest
```

<!-- TODO: jika infra/ sudah berisi docker-compose.yml, ganti dengan:
     docker compose -f infra/docker-compose.yml up -d -->

#### b. Install dependensi

```bash
cd apps/backend
npm install
```

#### c. Atur environment variable

```bash
cp .env.example .env
```

Contoh isi `.env` untuk lokal:

```env
PORT=3000
DATABASE_URL="sqlserver://localhost:1433;database=patunganku;user=sa;password=YourStrong!Passw0rd;trustServerCertificate=true"

# Hanya dibutuhkan untuk fitur upload dan verifikasi struk
AZURE_STORAGE_CONNECTION_STRING=
AZURE_STORAGE_CONTAINER=receipts
AI_VISION_API_KEY=
```

<!-- TODO: samakan nama variabel dengan apps/backend/.env.example dan src/config/ -->

#### d. Siapkan skema database

```bash
npx prisma generate
npx prisma migrate dev
```

#### e. Jalankan server

```bash
npm run dev
```

Server berjalan di `http://localhost:3000`.

<!-- TODO: cocokkan dengan "scripts" di apps/backend/package.json (dev / start) -->

#### f. Coba API

Import koleksi di folder `docs/postman/` ke Postman, lalu atur base URL ke `http://localhost:3000`.

### Masalah umum

| Masalah | Solusi |
| ------- | ------ |
| `Login failed for user 'sa'` | Pastikan password di `DATABASE_URL` sama dengan `MSSQL_SA_PASSWORD` dan kontainer sudah selesai start (tunggu sekitar 20 detik). |
| Port 1433, 3000, atau 5173 sudah dipakai | Hentikan proses lain atau ganti port. |
| `prisma migrate` gagal terhubung | Cek `docker ps`, pastikan `patunganku-db` berstatus `Up`. |
| Fitur upload struk error | Isi variabel Azure Blob dan AI vision di `.env`. |
| Frontend tidak memuat data dari backend | Memang belum terhubung, frontend masih memakai `mock.ts`. |

## Panduan Menambah Kode Backend

- Endpoint baru: tambah file di `routes/`, logikanya di `controllers/`
- Aturan bisnis (hitung split, cek saldo, dll.): taruh di `services/`, jangan di controller
- Perlu koneksi ke layanan luar (database, storage, AI): buat file baru di `lib/`
- Validasi input form/body: skema di `validators/`, dipanggil sebelum controller
