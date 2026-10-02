# Setup Backend — PatunganKu

Panduan menjalankan backend di laptop masing-masing. Ikuti urutannya persis.

## Prasyarat

- Node.js 22 atau lebih baru
- Docker Desktop (terinstal dan sedang berjalan)
- Git

## 1. Install dependency

```bash
cd apps/backend
npm install
```

> **Jangan** menjalankan `npm install prisma@latest`. Versi terbaru saat ini
> (Prisma 8, masih release candidate) memakai perintah CLI yang berbeda
> (`migrate` menjadi `migration`). Proyek ini memakai Prisma 7 (`^7` di
> `package.json`), jadi `npm install` biasa sudah cukup.

## 2. Siapkan file environment

```bash
cp .env.example .env
```

Isi `.env.example` sudah sesuai untuk database Docker lokal, tidak perlu diubah.

Password database mengandung karakter `#`, jadi nilainya wajib diberi tanda
kutip. Tanpa kutip, `#` dibaca sebagai awal komentar dan password terpotong:

```env
DB_PASSWORD="PatunganKu#2026"
```

## 3. Nyalakan database lokal (Docker)

```bash
cd ../../infra
docker compose up -d --wait
```

Perintah ini baru selesai setelah SQL Server dan Azurite berstatus `healthy`.

## 4. Jalankan migration

```bash
cd ../apps/backend
npx prisma migrate dev
```

Migration yang sudah ada di `prisma/migrations/` akan diterapkan ke database
lokal kamu. Prisma Client otomatis ter-generate ke `src/generated/prisma`.
Folder ini tidak di-commit, jadi jalankan `npx prisma generate` jika folder
tersebut belum ada.

## 5. Jalankan server

```bash
npm run dev
```

Cek di terminal lain:

```bash
curl http://localhost:4000/api/health
```

Hasil yang diharapkan: `{"status":"ok","timestamp":"..."}`.

## Konfigurasi database

`.env` sengaja berisi dua representasi koneksi karena Prisma 7 memisahkannya:

| Variabel                                                    | Dipakai oleh                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------- |
| `DATABASE_URL`                                              | Prisma CLI (`migrate`, `generate`) lewat `prisma.config.ts`               |
| `DB_SERVER`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Aplikasi saat runtime (`src/lib/prisma.js`) lewat `@prisma/adapter-mssql` |

Kalau password diganti, ubah di kedua tempat dan di `infra/docker-compose.yml`.

## Masalah umum

**`Login failed for user 'sa'`**
Password di `.env` tidak sama dengan password yang dipakai container, atau
nilainya terpotong karena `#` tanpa tanda kutip. Periksa kutipnya dulu. Jika
container lama memakai password berbeda, reset (hanya menghapus data
development):

```bash
cd infra
docker compose down -v
docker compose up -d --wait
cd ../apps/backend
npx prisma migrate dev
```

**`P1017: Server has closed the connection` / `read ECONNRESET`**
SQL Server belum siap menerima koneksi. Pastikan status `healthy`
(`docker compose ps`), tunggu 10–15 detik, lalu ulangi.

**`The "config.server" property is required`**
Variabel `DB_SERVER` dan sejenisnya tidak terbaca. Pastikan `.env` ada di
`apps/backend/.env` (bukan di root repo) dan nama variabelnya benar.

**`PrismaClient was instantiated without any options`**
Di Prisma 7, `PrismaClient` wajib diberi driver adapter. Gunakan instance dari
`src/lib/prisma.js`, jangan membuat `new PrismaClient()` sendiri.
