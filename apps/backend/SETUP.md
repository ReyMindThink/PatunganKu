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

## 4. Buat database dan jalankan migration

Backend v2 memakai database `patunganku_v2`. Database `patunganku` milik backend v1
tidak dipakai dan jangan disentuh (isinya bahan bukti laporan).

Pastikan `DB_NAME=patunganku_v2` dan `database=patunganku_v2` pada `DATABASE_URL`
di `.env` (`.env.example` sudah begitu). Buat database kosong lebih dulu. Di Git Bash
awali dengan `MSYS_NO_PATHCONV=1`. Password dibaca di dalam container, jadi tidak
perlu diketik:

```bash
MSYS_NO_PATHCONV=1 docker exec patunganku-sqlserver bash -c '/opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -Q "CREATE DATABASE patunganku_v2"'
```

Jika database itu sudah ada, perintah menjawab bahwa database sudah ada dan langkah
ini boleh dilewati. Lalu terapkan migration. Migration pertama membangun seluruh
skema: 16 tabel, trigger append-only, CHECK, dan dua indeks unik terfilter.

```bash
cd ../apps/backend
npx prisma migrate deploy
```

Hasil yang diharapkan: `All migrations have been successfully applied`. Langkah ini
sudah diuji pada database kosong (lihat K54 di `docs/architecture.md`).

Saat mengubah `schema.prisma`, buat migration baru dengan
`npx prisma migrate dev --create-only --name nama_perubahan`, lalu baca SQL-nya
sebelum diterapkan. Migration baru tidak boleh memuat `DROP INDEX` untuk
`UX_GroupMember_OneActiveOwner` atau `UX_LedgerEntry_Reverses`.

Prisma Client **tidak** otomatis ter-generate setelah `migrate dev`. `npm install`
sudah menjalankannya lewat skrip `postinstall`, tapi setiap kali `schema.prisma`
berubah (misalnya setelah `git pull` yang membawa migration baru), jalankan:

```bash
npx prisma generate
```

Folder `src/generated/` tidak di-commit.

## 5. Jalankan server

```bash
npm run dev
```

Cek di terminal lain:

```bash
curl http://localhost:4000/api/health
```

Hasil yang diharapkan: `{"status":"ok","timestamp":"..."}`.

## 6. Jalankan tes

Tes unit tidak membutuhkan database, dan `npm run check` hanya memeriksa sintaks
(bukan lint):

```bash
cd apps/backend
npm test
npm run check
```

Tes integrasi memakai SQL Server nyata dan menulis data permanen (tabel tambah-saja
tidak dapat dibersihkan), jadi harus memakai database terpisah yang namanya berakhiran
`_test`. Tes menolak berjalan pada nama lain, termasuk `patunganku_v2`. Buat database
itu sekali saja (dari akar repo):

```bash
MSYS_NO_PATHCONV=1 docker exec patunganku-sqlserver bash -c '/opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -Q "CREATE DATABASE patunganku_test"'
```

Terapkan migration ke database itu dengan mengganti nama database pada `DATABASE_URL`
hanya untuk perintah ini (`.env` tidak berubah), lalu jalankan tes:

```bash
cd apps/backend
DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"' | sed 's/database=patunganku_v2;/database=patunganku_test;/')" npx prisma migrate deploy
DB_NAME=patunganku_test npm run test:integration
```

Setiap ada migration baru, ulangi `migrate deploy` itu. Jika tes gagal dengan pesan
bahwa suatu kolom tidak ada, Prisma Client lokal masih hasil skema lama: jalankan
`npx prisma generate`. Di CI semua ini berjalan otomatis pada container SQL Server baru.

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
container lama memakai password berbeda, volume harus dibuat ulang.
**Peringatan:** `docker compose down -v` menghapus volume SQL Server **dan**
Azurite, jadi seluruh data development, termasuk foto struk uji, ikut hilang.
Cadangkan dulu bila datanya masih diperlukan.

```bash
cd infra
docker compose down -v
docker compose up -d --wait
```

Setelah itu ulangi langkah 4 (database `patunganku_v2` harus dibuat lagi).

**`P1017: Server has closed the connection` / `read ECONNRESET`**
SQL Server belum siap menerima koneksi. Pastikan status `healthy`
(`docker compose ps`), tunggu 10–15 detik, lalu ulangi.

**`The "config.server" property is required`**
Variabel `DB_SERVER` dan sejenisnya tidak terbaca. Pastikan `.env` ada di
`apps/backend/.env` (bukan di root repo) dan nama variabelnya benar.

**`PrismaClient was instantiated without any options`**
Di Prisma 7, `PrismaClient` wajib diberi driver adapter. Gunakan instance dari
`src/lib/prisma.js`, jangan membuat `new PrismaClient()` sendiri.

**`Cannot read properties of undefined (reading 'findUnique')`**
Prisma Client belum di-generate ulang setelah schema berubah, sehingga model
(misalnya `prisma.user`) belum ada. Jalankan `npx prisma generate`, lalu
server restart otomatis.

**`The API version ... is not supported by Azurite`**
Container Azurite lama belum memakai flag `--skipApiVersionCheck`. Setelah `git pull`, buat ulang containernya.
Container yang dibuat sebelum flag `--location /data` ditambahkan menyimpan data di
lapisan container, bukan di volume, sehingga data (foto struk uji) hilang saat dibuat
ulang. Salin dulu bila diperlukan (`docker cp patunganku-azurite:/opt/azurite <folder>`).
Container yang dibuat dari compose terbaru menyimpan data di volume dan tahan dibuat ulang:

```bash
cd infra
docker compose up -d --force-recreate azurite
```

## Verifikasi struk (Gemini)

Fitur verifikasi struk memakai Gemini API. Setiap anggota tim memakai API key sendiri:

1. Buat key di aistudio.google.com (menu API keys).
2. Isi `GEMINI_API_KEY` di `apps/backend/.env`. **Jangan** menempel key ke chat, commit, atau koleksi Postman.
3. `GEMINI_MODEL` sudah terisi di `.env.example`. Google bisa menutup model lama sewaktu-waktu (error `404 ... no longer available`). Kalau itu terjadi, ganti nilainya dengan model yang disarankan di pesan errornya.

**`Gemini HTTP 429` atau endpoint verify membalas `502`**
Kuota free tier habis atau model sedang sibuk. Status struk tidak berubah, jadi cukup ulangi beberapa saat lagi. Penyebab pastinya tercetak di terminal server dengan awalan `Verifikasi struk gagal:`.
