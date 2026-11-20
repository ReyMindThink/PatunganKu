# Deploy PatunganKu ke Azure (satu VM + Azure SQL + Blob)

Status dokumen: DRAF. Yang berlabel [T] terbukti (dengan bukti); [D] dugaan yang belum diuji;
[?] belum diketahui. Perintah `az` di bagian 5 BELUM PERNAH dijalankan: tiap langkah diberi
tanda terbukti hanya setelah dijalankan di Azure sungguhan.

Lingkup: backend v2 di satu VM Linux (Docker), database Azure SQL, struk dan bukti di Azure
Blob Storage. Frontend belum punya panggilan API ke backend, jadi belum dihosting [?].

## 1. Arsitektur

```
 Pengguna / Postman
        |  HTTPS 443 (HTTP 80 dialihkan)
        v
 +-------------------------- Azure, resource group rg-patunganku -----------------------+
 |  IP publik statis + nama DNS  <label>.<region>.cloudapp.azure.com                      |
 |        |                                                                               |
 |  NSG nsg-patunganku (80, 443 dari internet; 22 hanya dari IP admin)                    |
 |        |                                                                               |
 |  VNet vnet-patunganku 10.20.0.0/16                                                     |
 |   +- snet-app 10.20.1.0/27  ---- VM Ubuntu 24.04 (Docker)                              |
 |   |      Caddy :80/:443  --->  backend :4000 (tidak dibuka ke luar)                    |
 |   +- snet-data 10.20.1.32/28  (dicadangkan, kosong)                                    |
 |                                                                                        |
 |  Azure SQL Database  <-- firewall: hanya snet-app (service endpoint Microsoft.Sql)     |
 |  Storage account (blob receipts, privat) <-- hanya snet-app (Microsoft.Storage)        |
 +----------------------------------------------------------------------------------------+
   Keluar dari VM: Gemini API (443), Let's Encrypt (443), unduhan paket dan image Docker
```

Pembagian peran: Azure SQL adalah PaaS (Azure mengurus server dan patch); VM adalah IaaS
(kita mengurus OS, Docker, dan pembaruan). Itu pilihan yang disepakati dengan asisten:
deploy ke VM seperti mata kuliah PAW, database Azure SQL [T: dari percakapan dengan asisten
dan jawaban Rasyid; konfirmasi tertulis tenggat dan skop belum ada [?]].

## 2. Rencana alamat (metode Modul 3: CIDR dan VLSM)

Ruang alamat: 10.20.0.0/16 (bagian dari blok privat 10.0.0.0/8, 65.536 alamat). Kebutuhan
dari yang terbesar ke terkecil, seperti catatan Lab 3.2:

| Subnet | Kebutuhan | Mask | Blok | Network | Rentang host | Broadcast | Host usable (Modul) | Usable (Azure) |
|---|---|---|---|---|---|---|---|---|
| snet-app | 20 host | /27 = 255.255.255.224 | 32 | 10.20.1.0 | .1 - .30 | 10.20.1.31 | 30 | 27 |
| snet-data | 10 host | /28 = 255.255.255.240 | 16 | 10.20.1.32 | .33 - .46 | 10.20.1.47 | 14 | 11 |
| cadangan 1 | - | /28 | 16 | 10.20.1.48 | .49 - .62 | 10.20.1.63 | 14 | - |
| cadangan 2 | - | /26 = 255.255.255.192 | 64 | 10.20.1.64 | .65 - .126 | 10.20.1.127 | 62 | - |
| cadangan 3 | - | /25 = 255.255.255.128 | 128 | 10.20.1.128 | .129 - .254 | 10.20.1.255 | 126 | - |

Hitungan: jumlah host usable = 2^(bit host) - 2. Azure memakai 5 alamat per subnet (network,
gateway default, dua untuk DNS, broadcast), sehingga usable Azure = 2^(bit host) - 5. Itu
berbeda dari rumus modul. snet-app /27 cukup untuk satu VM dan ruang tumbuh; snet-data tidak
berisi sumber daya sekarang dan disiapkan bila kelak memakai private endpoint. Seluruh
10.20.1.0/24 terpakai habis oleh lima blok di atas; 10.20.2.0 ke atas masih kosong.

Routing (Lab 3.3): VNet memakai rute sistem Azure (10.20.0.0/16 ke VNet, 0.0.0.0/0 ke
Internet). Tidak ada rute buatan (UDR); sama seperti routing statis satu gateway keluar.

## 3. Aturan jaringan (NSG dan firewall)

NSG pada subnet snet-app (aturan bawaan Azure AllowVnetInBound, AllowAzureLoadBalancerInBound,
DenyAllInBound tetap berlaku):

| Prioritas | Nama | Arah | Aksi | Protokol | Port | Sumber |
|---|---|---|---|---|---|---|
| 100 | allow-http | Masuk | Izinkan | TCP | 80 | Internet |
| 110 | allow-https | Masuk | Izinkan | TCP | 443 | Internet |
| 120 | allow-ssh-admin | Masuk | Izinkan | TCP | 22 | IP publik admin/32 |
| 65500 | DenyAllInBound (bawaan) | Masuk | Tolak | Semua | Semua | Semua |

- Port 80 diperlukan Caddy untuk tantangan sertifikat Let's Encrypt dan pengalihan ke HTTPS.
- Port 4000 (backend) dan 1433 (SQL) tidak dibuka. Backend hanya terjangkau lewat Caddy di
  jaringan Docker; compose produksi memakai expose, bukan ports, untuk backend.
- Keluar (outbound) dibiarkan bawaan: VM perlu ke Gemini, Azure SQL, Blob, dan unduhan paket.
- Azure SQL: server firewall memakai aturan jaringan virtual (snet-app, service endpoint
  Microsoft.Sql); "Allow Azure services" dimatikan. Cadangan bila service endpoint bermasalah:
  satu aturan IP untuk IP publik VM [D].
- Storage account: akses jaringan terbatas ke snet-app (Microsoft.Storage), akses publik ke
  blob dimatikan, container receipts privat.
- Caddy membatasi body permintaan 8 MB (struk maksimal 5 MB); CORS ketat lewat CORS_ORIGIN;
  trust proxy = 1 supaya batas laju memakai IP pengguna sungguhan.

## 4. Konfigurasi aplikasi di VM

Salin apps/backend/production.env.example menjadi apps/backend/.env di VM (chmod 600), isi
semua nilai GANTI_*. Server menolak start (kode keluar 1 dengan pesan kolom) bila di
production: CORS_ORIGIN `*`, DB_ENCRYPT bukan true, atau DB_TRUST_SERVER_CERT bukan false
[T: tes unit dan uji muat]. Akun database untuk aplikasi (pk_app) hanya db_datareader dan
db_datawriter; terbukti 94 tes integrasi lulus tanpa hak DDL dan DDL ditolak [T: lokal,
SQL Server 2022]. Migrasi memakai akun lain lewat DATABASE_URL.

Bukti yang sudah ada secara lokal [T]: image dibangun (1,26 GB), berjalan sebagai user node,
/api/health/ready 200 ke SQL Server, docker stop memberi kode keluar 0 dalam kurang dari
satu detik dengan log SIGTERM, prisma migrate deploy berjalan di dalam container.
Belum terbukti: Caddy, HTTPS, Azure SQL, Azure Blob, VM.

## 5. Langkah deploy (DRAF [D], jalankan dan tandai satu per satu)

Prasyarat: pemilik subscription memberi akun Anda peran Contributor pada SATU resource group
lewat Access control (IAM). Jangan meminta atau membagikan kata sandi akun. Pasang budget
alert di Cost Management. Nama sumber daya di bawah adalah usulan.

```bash
az login
az account set --subscription "<ID_SUBSCRIPTION>"
RG=rg-patunganku
LOC=southeastasia
az group create --name $RG --location $LOC          # bila grup belum dibuat pemilik

# Jaringan (bagian 2 dan 3)
az network vnet create -g $RG -n vnet-patunganku --address-prefixes 10.20.0.0/16 \
  --subnet-name snet-app --subnet-prefixes 10.20.1.0/27
az network vnet subnet create -g $RG --vnet-name vnet-patunganku -n snet-data \
  --address-prefixes 10.20.1.32/28
az network vnet subnet update -g $RG --vnet-name vnet-patunganku -n snet-app \
  --service-endpoints Microsoft.Sql Microsoft.Storage
az network nsg create -g $RG -n nsg-patunganku
az network nsg rule create -g $RG --nsg-name nsg-patunganku -n allow-http --priority 100 \
  --direction Inbound --access Allow --protocol Tcp --destination-port-ranges 80 \
  --source-address-prefixes Internet
az network nsg rule create -g $RG --nsg-name nsg-patunganku -n allow-https --priority 110 \
  --direction Inbound --access Allow --protocol Tcp --destination-port-ranges 443 \
  --source-address-prefixes Internet
az network nsg rule create -g $RG --nsg-name nsg-patunganku -n allow-ssh-admin --priority 120 \
  --direction Inbound --access Allow --protocol Tcp --destination-port-ranges 22 \
  --source-address-prefixes "<IP_PUBLIK_ADMIN>/32"
az network vnet subnet update -g $RG --vnet-name vnet-patunganku -n snet-app \
  --network-security-group nsg-patunganku

# IP publik statis (SKU Standard; SKU Basic sudah dihentikan Azure [D]) dan VM
az network public-ip create -g $RG -n pip-patunganku --sku Standard \
  --allocation-method Static --dns-name "<LABEL_UNIK>"
az vm create -g $RG -n vm-patunganku --image Ubuntu2404 --size Standard_B2s \
  --admin-username azureuser --ssh-key-values ~/.ssh/id_ed25519.pub \
  --vnet-name vnet-patunganku --subnet snet-app --public-ip-address pip-patunganku \
  --nsg ""

# Azure SQL (kata sandi admin dibaca tanpa tampil; jangan simpan di riwayat perintah)
read -s -p "Kata sandi admin SQL: " SQLPW; echo
az sql server create -g $RG -n "<NAMA_SERVER_SQL>" -l $LOC --admin-user sqladmin \
  --admin-password "$SQLPW"
az sql db create -g $RG -s "<NAMA_SERVER_SQL>" -n patunganku --edition GeneralPurpose \
  --compute-model Serverless --use-free-limit --free-limit-exhaustion-behavior AutoPause
az sql server vnet-rule create -g $RG -s "<NAMA_SERVER_SQL>" -n allow-snet-app \
  --vnet-name vnet-patunganku --subnet snet-app
unset SQLPW

# Blob Storage
az storage account create -g $RG -n "<NAMA_STORAGE>" --sku Standard_LRS --kind StorageV2 \
  --allow-blob-public-access false --default-action Deny
az storage account network-rule add -g $RG --account-name "<NAMA_STORAGE>" \
  --vnet-name vnet-patunganku --subnet snet-app
az storage container create --account-name "<NAMA_STORAGE>" -n receipts --auth-mode login
```

Catatan: tawaran gratis Azure SQL (`--use-free-limit`) bergantung jenis subscription; bila
ditolak, pakai tier Basic atau serverless berbayar terendah [?]. Tanda `--nsg ""` pada
az vm create dimaksudkan agar VM tidak membuat NSG sendiri karena NSG sudah dipasang di
subnet [D]; periksa hasilnya di portal.

Di VM (SSH sebagai azureuser):

```bash
curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker azureuser
git clone https://github.com/ReyMindThink/PatunganKu.git && cd PatunganKu
git checkout 545518        # atau main setelah v2 digabung
cp apps/backend/production.env.example apps/backend/.env && chmod 600 apps/backend/.env
nano apps/backend/.env     # isi semua GANTI_*; NODE_ENV=production
echo "SITE_ADDRESS=<LABEL_UNIK>.<region>.cloudapp.azure.com" > infra/.env
docker compose -f infra/docker-compose.prod.yml up -d --build
docker compose -f infra/docker-compose.prod.yml run --rm backend npx prisma migrate deploy
```

Lalu jalankan infra/sql/akun-app-azure.sql pada database patunganku (setelah mengganti kata
sandi) memakai Query editor di portal, dan isi DB_USER=pk_app serta DB_PASSWORD di .env,
lalu `docker compose -f infra/docker-compose.prod.yml up -d` agar backend memuat ulang .env.

## 6. Verifikasi setelah deploy (bukti untuk laporan)

| # | Pemeriksaan | Perintah dari laptop | Harapan [D] |
|---|---|---|---|
| 1 | HTTPS dan sertifikat sah | `curl -sI https://<domain>/api/health` | 200 |
| 2 | HTTP dialihkan | `curl -sI http://<domain>/api/health` | 308 ke https |
| 3 | Kesiapan dan database | `curl -s https://<domain>/api/health/ready` | `{"status":"ready","checks":{"database":"ok"}}` |
| 4 | Backend tidak terbuka | `curl -m 5 http://<domain>:4000/api/health` | gagal (batas waktu) |
| 5 | SQL tidak terbuka dari internet | `nc -zv -w 5 <server>.database.windows.net 1433` dari jaringan lain | ditolak firewall SQL saat login |
| 6 | SSH hanya dari IP admin | SSH dari jaringan lain | batas waktu |
| 7 | Alur API | koleksi Newman (T1.11) | semua assertion lulus |

Tangkapan layar portal (NSG, VNet, firewall SQL) dan keluaran perintah di atas menjadi lampiran
laporan jaringan dan awan.

## 7. Operasi dan biaya

- Mematikan setelah demo: `az vm deallocate -g rg-patunganku -n vm-patunganku`; menyalakan:
  `az vm start`. VM yang dideallocate tidak ditagih komputasinya, tetapi IP statis, disk,
  Storage, dan SQL tetap ditagih kecil [D]; cek kalkulator harga Azure sebelum memilih ukuran.
- Pembaruan aplikasi: `git pull`, lalu `docker compose -f infra/docker-compose.prod.yml up -d --build`
  dan migrasi bila ada migration baru.
- Restart otomatis: restart: unless-stopped pada kedua layanan; stop_grace_period 30 detik.
- Cadangan database: bawaan Azure SQL (periode retensi diperiksa di portal [?]).

## 8. Pemetaan ke rubrik

| Rubrik | Yang disiapkan | Status |
|---|---|---|
| Jaringan komputer (20%) | Rencana alamat CIDR/VLSM, NSG, firewall SQL dan storage, reverse proxy HTTPS, trust proxy, CORS | Desain tertulis; bukti Azure menunggu deploy |
| Komputasi awan (20%) | VM (IaaS), Azure SQL (PaaS), Blob Storage, kontainer Docker | Lokal terbukti; Azure menunggu deploy dan akun teman |
| Dokumentasi (20%) | Dokumen ini, SETUP.md, riwayat Git, issue per modul | Berjalan |

## 9. Belum diketahui atau belum diputuskan

- Region, ukuran VM, dan apakah tawaran gratis Azure SQL tersedia di subscription teman [?].
- Nama domain (label DNS bawaan Azure sudah cukup untuk sertifikat Let's Encrypt) [?].
- Hosting frontend (Caddy dapat menyajikan hasil build statis bila frontend siap) [?].
- Tenggat deploy dan apakah APK atau PWA diwajibkan: belum ada jawaban asisten [?].
