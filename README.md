# PatunganKu

Aplikasi web (PWA, mobile-first) untuk mencatat, membagi, dan memverifikasi pengeluaran bersama dalam grup (kos, KKN, open trip). Foto struk diverifikasi oleh AI vision sebelum nominalnya masuk ke pembagian tagihan, dan riwayat disimpan di Azure.

Senior Project (Jaringan Komputer, Komputasi Awan, dan AI), DTETI FT UGM, Kelompok 12.

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
│   ├── backend/     # REST API
│   └── frontend/    # aplikasi web
├── site/            # halaman GitHub Pages kelompok
├── infra/           # konfigurasi infrastruktur (Docker, Azure)
└── .github/         # workflow CI/CD, template issue dan PR


