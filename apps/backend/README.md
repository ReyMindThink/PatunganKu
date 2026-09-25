# PatunganKu

Aplikasi untuk mencatat, membagi, dan memverifikasi pengeluaran bersama dalam grup (kos, KKN, open trip). Foto struk diverifikasi oleh AI vision sebelum nominalnya masuk ke pembagian tagihan, dan riwayat disimpan di Azure.

Senior Project, DTETI FT UGM, Kelompok 12.

## Anggota

| Nama | NIM | Peran |
|---|---|---|
| Bintang Khalifa Hadianto (Ketua) | 24/534951/TK/59312 | AI Engineer, Software Engineer |
| Aqidatul Izzah | 24/533730/TK/59137 | UI/UX, Software Engineer |
| Rasyid Rayhan Novandy | 24/545518/TK/60688 | Cloud Engineer, Software Engineer |

## Teknologi (rencana)

| Bagian | Teknologi |
|---|---|
| Backend | Node.js, Express |
| Database | Azure SQL Database |
| Penyimpanan struk | Azure Blob Storage |
| Frontend | React + Vite (PWA) |
| Kontainer | Docker, Docker Compose |
| CI/CD | GitHub Actions |

## Struktur Repository

```text
PatunganKU/
├── apps/
│   ├── backend/
│   │   ├── prisma/          # schema database dan migration
│   │   └── src/
│   │       ├── config/      # env loader, konstanta
│   │       ├── controllers/ # terima request, panggil service, bentuk response
│   │       ├── routes/      # definisi endpoint per resource
│   │       ├── middlewares/ # auth, error handler, dll.
│   │       ├── services/    # logika bisnis (split bill, verifikasi struk, dll.)
│   │       ├── validators/  # skema validasi input request
│   │       ├── lib/         # integrasi eksternal: Prisma client, Azure Blob, AI vision
│   │       └── utils/       # helper umum
│   └── frontend/            # aplikasi web (belum dimulai)
├── site/                    # halaman GitHub Pages kelompok
├── infra/                   # konfigurasi infrastruktur (Docker, Azure)
└── .github/                 # workflow CI/CD, template issue dan PR
```

### Panduan menambah kode backend

- Endpoint baru → tambah file di `routes/`, logic-nya di `controllers/`
- Aturan bisnis (hitung split, cek saldo, dll.) → taruh di `services/`, jangan di controller
- Perlu koneksi ke layanan luar (database, storage, AI) → buat file baru di `lib/`
- Validasi input form/body → skema di `validators/`, dipanggil sebelum controller
