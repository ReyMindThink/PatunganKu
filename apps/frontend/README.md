# PatunganKu - Frontend

Antarmuka web PatunganKu: login/daftar, daftar grup, serta form buat dan gabung grup.
Dibangun dengan React 19, TypeScript, dan Vite. Gaya memakai CSS biasa dengan design token.

> Status: tampilan sudah berjalan secara lokal. Halaman masih memakai data contoh
> (`src/data/mock.ts`) dan belum terhubung ke backend.

## Menjalankan secara lokal

Prasyarat: Node.js 20.19 atau lebih baru dan [pnpm](https://pnpm.io/installation).

```bash
cd apps/frontend
pnpm install
pnpm dev
```

Buka http://localhost:5173. Untuk tampilan ponsel, buka DevTools lalu aktifkan mode perangkat (lebar 393 px).

| Perintah         | Fungsi                                  |
| ---------------- | --------------------------------------- |
| `pnpm dev`       | Server pengembangan dengan hot reload   |
| `pnpm build`     | Cek tipe lalu build produksi ke `dist/` |
| `pnpm preview`   | Jalankan hasil build secara lokal       |
| `pnpm typecheck` | Cek tipe TypeScript saja                |

## Struktur

```
src/
├── components/   # komponen UI yang dipakai ulang (Button, Field, Receipt, Rings, ...)
├── pages/        # satu file per halaman (AuthPage, HomePage, GroupFormPage)
├── data/         # data contoh sementara
├── lib/          # helper murni (format rupiah, inisial, dll.)
├── styles/       # design token, gaya dasar, animasi perpindahan halaman
├── types.ts      # tipe bersama
└── App.tsx       # pengatur perpindahan halaman
```

Setiap komponen punya file CSS di sebelahnya (`Button.tsx` dengan `Button.css`) dan memakai
penamaan BEM sederhana (`receipt__row`, `group-row__name`).

## Mengubah tampilan

Semua warna, font, dan radius ada di `src/styles/tokens.css`. Ubah di sana, jangan menulis
ulang nilai warna di file komponen. Font memakai Plus Jakarta Sans lewat paket
`@fontsource-variable/plus-jakarta-sans`, jadi tidak membutuhkan koneksi ke layanan font luar.

## PWA

`public/manifest.webmanifest` dan ikon di `public/icons/` sudah tersedia. Service worker
(mode offline) belum dibuat.
