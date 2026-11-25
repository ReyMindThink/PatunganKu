# Panduan demo PatunganKu

Panduan ini memperagakan alur utama backend lewat terminal (Git Bash): tiga pengguna mendaftar, membuat dan memasuki grup, satu orang menalangi pengeluaran dengan foto struk, saldo terbentuk, lalu utang dilunasi dengan tunai dan dengan transfer berbukti. Waktu yang dibutuhkan sekitar 10 menit. Frontend belum terhubung ke backend, jadi seluruh demo memakai API langsung.

## Yang diperlihatkan

| Langkah | Fitur |
| --- | --- |
| 1 sampai 4 | Kesehatan server, akun, grup, bergabung dengan kode |
| 5 sampai 8 | Metode pembayaran terenkripsi, draft transaksi, unggah dan verifikasi struk oleh AI, submit |
| 9 | Pembagian rata dengan pembulatan sisa terbesar, saldo per pasangan |
| 10 dan 11 | Pelunasan tunai dan transfer berbukti, konfirmasi penerima |
| 12 | Penolakan nominal berlebih dan jalur persetujuan bila struk gagal |

## Prasyarat

1. Backend berjalan di `http://localhost:4000` mengikuti `apps/backend/SETUP.md` (Docker, migration, `npm run dev`). Cek dengan `curl http://localhost:4000/api/health`.
2. Di `apps/backend/.env`: `GEMINI_API_KEY` yang berlaku, `AZURE_STORAGE_CONNECTION_STRING` untuk Azurite (nilai bawaan di `.env.example`), dan `PAYMENT_ENC_KEY` (cara membuatnya ada di `SETUP.md`). Mulai ulang server setelah mengubah `.env`.
3. **Satu foto struk milik sendiri** (JPEG, PNG, atau WebP, di bawah 5 MB) dengan total yang terbaca jelas dan tidak lebih dari Rp100.000.000. Foto ini dikirim ke Google Gemini API, jadi pilih struk yang tidak memuat data pribadi dan simpan di luar repository.
4. Satu gambar apa saja untuk bukti transfer pada langkah 11.

Setiap pengguna demo memakai email yang memuat penanda waktu, sehingga demo bisa diulang tanpa membersihkan data. Bila pendaftaran dijawab 429 (pembatas laju), tunggu sesuai header `Retry-After`.

## Persiapan terminal

Tempel sekali di awal. `U` membuat Idempotency-Key, `J` mengambil nilai dari JSON tanpa perlu `jq`, dan `api` mengirim permintaan JSON dengan token.

```bash
BASE=http://localhost:4000/api
U() { command node -e "console.log(require('crypto').randomUUID())"; }
J() { command node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let o;try{o=JSON.parse(s)}catch(e){console.log("(bukan JSON)");return}const v=process.argv[1].split(".").reduce((a,k)=>a==null?a:a[k],o);console.log(typeof v==="object"?JSON.stringify(v):v)})' "$1"; }
api() { local m=$1 p=$2 t=$3 b=$4
  if [ -n "$b" ]; then curl -s -X "$m" "$BASE$p" -H "Authorization: Bearer $t" -H "Content-Type: application/json" -H "Idempotency-Key: $(U)" -d "$b"
  else curl -s -X "$m" "$BASE$p" -H "Authorization: Bearer $t" -H "Idempotency-Key: $(U)"; fi; }
FOTO="/jalur/ke/struk.jpg"      # ganti dengan jalur foto struk Anda
BUKTI="/jalur/ke/bukti.jpg"     # ganti dengan gambar bukti transfer apa saja
AMOUNT=0                        # ganti dengan TOTAL yang tertulis pada struk (rupiah bulat)
```

## Langkah demo

### 1. Kesehatan server

```bash
curl -s $BASE/health; echo
curl -s $BASE/health/ready; echo
```

Harapan: `status` bernilai `ok`. Jalur `ready` memeriksa koneksi database dan menjawab 503 bila database tidak terjangkau.

### 2. Tiga pengguna mendaftar

```bash
S=$(date +%s)
reg() { curl -s -X POST "$BASE/auth/register" -H "Content-Type: application/json" -d "{\"email\":\"demo-$1-$S@example.com\",\"password\":\"RahasiaDemo123\",\"name\":\"Demo $1\"}"; }
RA=$(reg a); RB=$(reg b); RC=$(reg c)
TA=$(echo "$RA" | J data.accessToken); IDA=$(echo "$RA" | J data.user.id)
TB=$(echo "$RB" | J data.accessToken); IDB=$(echo "$RB" | J data.user.id)
TC=$(echo "$RC" | J data.accessToken); IDC=$(echo "$RC" | J data.user.id)
echo "id: $IDA $IDB $IDC"
```

Harapan: tiga id angka berbeda. Token berlaku 1 jam. Demo A akan menjadi penalang.

### 3. A membuat grup

```bash
G=$(api POST /groups "$TA" '{"name":"Demo Kos"}')
GID=$(echo "$G" | J data.id); CODE=$(echo "$G" | J data.code)
echo "grup $GID, kode $CODE"
```

### 4. B dan C bergabung dengan kode

```bash
api POST /groups/join "$TB" "{\"code\":\"$CODE\"}" | J data.memberCount
api POST /groups/join "$TC" "{\"code\":\"$CODE\"}" | J data.memberCount
api GET /groups/$GID/members "$TA" | J data
```

Harapan: jumlah anggota menjadi 2 lalu 3, dan daftar anggota memuat ketiganya.

### 5. A menambah metode pembayaran

Penalang wajib punya minimal satu metode pembayaran aktif sebelum bisa mengirim transaksi. Nomor rekening disimpan terenkripsi dan hanya dibuka untuk pemilik atau pihak yang berutang kepadanya.

```bash
M=$(api POST /me/payment-methods "$TA" '{"kind":"BANK","provider":"BCA","accountNo":"1234567890","accountName":"Demo A"}')
MID=$(echo "$M" | J data.id); echo "metode $MID"
```

### 6. A membuat draft transaksi

Nominal harus sama dengan total pada struk, kalau tidak verifikasi akan mencatat ketidaksesuaian.

```bash
T=$(api POST /groups/$GID/transactions "$TA" "{\"description\":\"Makan bersama\",\"amount\":$AMOUNT}")
TID=$(echo "$T" | J data.id); echo "transaksi $TID, status $(echo "$T" | J data.status)"
```

### 7. Unggah dan verifikasi struk

```bash
curl -s -X POST "$BASE/groups/$GID/transactions/$TID/receipt" -H "Authorization: Bearer $TA" -H "Idempotency-Key: $(U)" -F "receipt=@$FOTO" | J data
V=$(api POST /groups/$GID/transactions/$TID/receipt/verify "$TA")
echo "keputusan: $(echo "$V" | J data.decision)"
echo "terbaca: $(echo "$V" | J data.detected)"
```

Harapan: keputusan `VERIFIED` dengan alasan `ok` dan total terbaca sama dengan `AMOUNT`. Hasil lain (`FAILED` atau `NEEDS_REVIEW`) dijelaskan pada langkah 12. Verifikasi memanggil Gemini dan bisa memakan beberapa detik.

### 8. Submit

```bash
api POST /groups/$GID/transactions/$TID/submit "$TA" | J data.transaction.status
```

Harapan: `ACTIVE`. Pembagian rata ke tiga anggota dan entri ledger tertulis dalam satu transaksi database. Kalau A belum punya metode pembayaran (langkah 5 dilewati), jawabannya 409 `payment-method-required` dan tidak ada yang tertulis.

### 9. Saldo

```bash
api GET /groups/$GID/balances "$TA" | J data
OWE_B=$(api GET /groups/$GID/balances/$IDB "$TB" | J data.owes); echo "B berutang: $OWE_B"
OWE_C=$(api GET /groups/$GID/balances/$IDC "$TC" | J data.owes); echo "C berutang: $OWE_C"
```

Harapan: B dan C masing-masing berutang sepertiga nominal kepada A. Bila nominal tidak habis dibagi tiga, selisih rupiah dibagi dengan metode sisa terbesar (Rp70.000 menjadi 23.334, 23.333, 23.333), sehingga jumlah bagian selalu persis sama dengan nominal.

### 10. B melunasi dengan tunai

```bash
P=$(curl -s -X POST "$BASE/groups/$GID/payments" -H "Authorization: Bearer $TB" -H "Idempotency-Key: $(U)" -F receiverId=$IDA -F amount=$OWE_B -F methodType=CASH)
PID=$(echo "$P" | J data.id); echo "pelunasan $PID, status $(echo "$P" | J data.status)"
api GET "/groups/$GID/balances/$IDB" "$TB" | J data.owes
api POST /groups/$GID/payments/$PID/confirm "$TA" | J data.status
api GET "/groups/$GID/balances/$IDB" "$TB" | J data.owes
```

Harapan: status `PENDING`, utang B belum berubah, lalu A mengonfirmasi (`CONFIRMED`) dan utang B menjadi 0. Saldo baru berubah saat penerima mengonfirmasi.

### 11. C melunasi dengan transfer berbukti

```bash
P2=$(curl -s -X POST "$BASE/groups/$GID/payments" -H "Authorization: Bearer $TC" -H "Idempotency-Key: $(U)" -F receiverId=$IDA -F amount=$OWE_C -F methodType=BANK -F methodId=$MID -F "proof=@$BUKTI")
PID2=$(echo "$P2" | J data.id); echo "pelunasan $PID2: $(echo "$P2" | J data.method)"
curl -s -H "Authorization: Bearer $TA" "$BASE/groups/$GID/payments/$PID2/proof" -o bukti-unduhan.bin; wc -c < bukti-unduhan.bin
api POST /groups/$GID/payments/$PID2/confirm "$TA" | J data.status
api GET /groups/$GID/balances "$TA" | J data
```

Harapan: pelunasan memuat metode bank A (hanya penyedia dan nama pemilik, tanpa nomor rekening), A dapat mengunduh bukti, setelah konfirmasi seluruh saldo menjadi 0. Berkas `bukti-unduhan.bin` dapat dihapus. Bukti hanya bisa dibaca pengirim dan penerima, tidak pernah tersedia lewat alamat publik.

### 12. Penolakan dan jalur persetujuan

Nominal berlebih ditolak. B sudah lunas, jadi ia tidak boleh mengirim pelunasan lagi:

```bash
curl -s -X POST "$BASE/groups/$GID/payments" -H "Authorization: Bearer $TB" -H "Idempotency-Key: $(U)" -F receiverId=$IDA -F amount=1000 -F methodType=CASH | J code
```

Harapan: `amount-exceeds-debt`.

Bila verifikasi struk pada langkah 7 menghasilkan `FAILED` atau `NEEDS_REVIEW` (misalnya total pada struk tidak sama dengan nominal), submit tidak langsung menjadikan transaksi aktif, melainkan menunggu persetujuan:

```bash
api POST /groups/$GID/transactions/$TID/submit "$TA" | J data.transaction.status    # PENDING_APPROVAL
AID=$(api GET /groups/$GID/approvals "$TB" | J data.0.id)
api POST /groups/$GID/approvals/$AID/votes "$TB" '{"vote":"APPROVE"}' | J data
```

Pemilih adalah anggota aktif selain pengaju. Dengan tiga anggota dan satu admin, satu suara setuju cukup. Setelah disetujui, transaksi menjadi `ACTIVE` dan langkah 9 dan seterusnya berlaku sama.

## Kesalahan umum

| Gejala | Penyebab dan tindakan |
| --- | --- |
| 401 | Token tidak ada atau kedaluwarsa (berlaku 1 jam). Daftar atau masuk lagi |
| 400 pada field `Idempotency-Key` | Header tidak terkirim. Fungsi `api` sudah menambahkannya, perintah `curl` manual harus menyertakan `-H "Idempotency-Key: $(U)"` |
| 415 atau 413 pada unggah | Format bukan JPEG, PNG, atau WebP, atau berkas lebih dari 5 MB |
| 502 `upstream-error` pada verifikasi | Gemini tidak menjawab atau kuota habis. Status struk tidak berubah, ulangi beberapa saat lagi. Bila terus terjadi, ganti `GEMINI_MODEL` (lihat `SETUP.md`) |
| 409 `payment-method-required` | Penalang belum punya metode pembayaran aktif (langkah 5) |
| 409 `duplicate-receipt` | Foto struk yang sama sudah dipakai di grup ini. Pakai foto lain |
| 429 | Terlalu banyak permintaan. Tunggu waktu yang disebut header `Retry-After` |

## Bila Gemini atau jaringan tidak tersedia

Verifikasi struk bergantung pada layanan luar, dan demo end-to-end tidak punya jalur pengganti tanpa itu. Sebagai bukti alternatif, seluruh alur di atas (termasuk pelunasan serentak dan penolakan nominal berlebih) diuji otomatis di SQL Server asli oleh `npm run test:integration` di `apps/backend` (134 tes), dan hasil CI per commit dapat dilihat di tab Actions repository.
