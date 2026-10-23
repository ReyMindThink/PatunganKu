# Roadmap PatunganKu

Sumber tunggal rencana tahap dan definisi selesai. Bagian yang diapit penanda issue (komentar HTML) dipakai apa adanya sebagai isi issue GitHub tiap tahap, mengikuti template Task: Deskripsi, Deliverable, Acceptance criteria, Dependency, PIC. Rancangan teknis ada di docs/architecture.md, kontrak API di docs/api-contract.md, dan panduan frontend di docs/frontend-brief.md.

Status: Tahap 0 hampir selesai. Tahap 1 sampai 5 belum dimulai.

## 1. Prinsip

1. Setiap tahap berdiri sendiri. Bila waktu habis di tengah jalan, tahap sebelumnya tetap menjadi produk utuh yang dapat dijalankan dan diserahkan.
2. Issue ditutup hanya dengan bukti tes terlampir di komentar penutup: tautan CI hijau, keluaran tes, atau tangkapan layar tanpa secret.
3. Kotak centang dicentang hanya bila buktinya ada. Pekerjaan yang selesai sebagian tidak dicentang.
4. Migration dipecah per tahap. Tabel dan kolom dibuat pada tahap yang memakainya, mengikuti ERD di architecture.md bagian 6. Tabel yang belum dipakai tidak dibuat lebih awal.
5. Tidak ada tenggat tanggal. Pertimbangan waktu hanya lewat garis potong di bagian 12.
6. Perubahan urutan dari rencana awal dicatat di bagian 13, bukan diam-diam di issue.
7. PIC frontend pada setiap tahap adalah Aqidatul. Bila pembagiannya berubah, perbarui issue tahap dan dokumen ini bersamaan.

## 2. Ringkasan tahap

| Tahap | Isi | Hasil bila berhenti di sini |
|---|---|---|
| 0 | Penutupan rancangan | Dokumen siap, belum ada produk baru |
| 1 | Inti nilai jual | Pencatat patungan utuh: verifikasi struk, persetujuan, ledger, pelunasan |
| 2 | Pembeda | Ditambah pilih item real-time, revisi, peran dan keluar-masuk anggota, sesi aman, pemulihan kata sandi |
| 3 | Pendukung | Ditambah chat, dana kelompok, pengingat, ganti email |
| 4 | Pengerasan | Ditambah hapus akun, logging, job pembersih, TypeScript |
| 5 | Terakhir | Ditambah chatbot dan penyebaran Azure |

## 3. Tahap 0: Penutupan rancangan

<!-- issue:tahap-0:start -->
### Deskripsi
Menutup rancangan: dokumen arsitektur, kontrak API, panduan frontend, dan roadmap masuk ke main. Sumber: docs/roadmap.md bagian 3.

### Deliverable
- [ ] docs/architecture.md, docs/api-contract.md, docs/frontend-brief.md, dan docs/roadmap.md di main lewat PR (PIC: Rasyid)
- [ ] Review kontrak oleh Aqidatul lewat docs/frontend-brief.md bagian 7 (PIC: Aqidatul)
- [ ] Review kontrak AI oleh Bintang (PIC: Bintang)
- [ ] Issue Tahap 1 sampai 5 dan tiga issue lintas dibuat (PIC: Rasyid)

### Acceptance criteria
- [ ] PR dokumen digabung ke main dengan CI hijau
- [ ] Tanggapan review Aqidatul dan Bintang tercatat sebagai komentar, atau dicatat "belum ada tanggapan" beserta tanggalnya. Review tidak menahan Tahap 1. Perubahan susulan dicatat sebagai addendum di architecture.md atau api-contract.md
- [ ] Bukti: tautan PR dan tangkapan CI hijau

### Dependency
Tidak ada.

### PIC
Rasyid. Peninjau: Aqidatul dan Bintang.
<!-- issue:tahap-0:end -->

## 4. Tahap 1: Inti nilai jual

<!-- issue:tahap-1:start -->
### Deskripsi
Inti nilai jual: dari foto struk yang diverifikasi AI, persetujuan, ledger append-only, sampai pelunasan. Setelah tahap ini aplikasi berdiri sebagai pencatat patungan utuh. Sumber: docs/roadmap.md bagian 4. Kontrak: docs/api-contract.md. Rancangan: docs/architecture.md.

Batasan tahap ini: sebelum Tahap 2 hanya OWNER yang menjadi admin. Pengangkatan admin, pengaturan grup, undangan, dan permintaan gabung menyusul. Mode ITEMIZED menyusul di Tahap 2. Event Socket.IO belum ada, jadi klien mengambil ulang lewat REST.

### Deliverable
Backend (PIC: Rasyid)
- [ ] T1.1 Migration subset Tahap 1 (User, Group, GroupMember, Transaction, TransactionShare, PaymentConfirmation, LedgerEntry, AuditLog, ReceiptExtraction, ReceiptItem, Approval, ApprovalVote, Notification, PaymentMethod, IdempotencyKey), trigger append-only, CHECK, filtered index, kolom phone dihapus, reset DB dev (G3)
- [ ] T1.2 Infrastruktur tes integrasi: SQL Server sebagai service container di CI, helper dan pabrik data uji, job frontend (typecheck dan build) di CI
- [ ] T1.3 Fondasi API: problem+json (K42), pembungkus data, validasi lewat errorHandler, requireActiveMember dan requireRole (K33), Idempotency-Key, pagination kursor, pembantu AuditLog (K19) beserta GET audit, batas laju
- [ ] T1.4 Auth v2 dan profil: daftar dan masuk (K44), GET dan PATCH /me, ganti kata sandi, algoritma HS256 (K45), batas laju login dan daftar (K47). Refresh token menyusul di Tahap 2
- [ ] T1.5 Grup dasar: objek tanpa email (K33), buat, daftar, detail, gabung lewat kode (outcome JOINED), batas 50 anggota dan batas percobaan kode (K32), daftar anggota
- [ ] T1.6 Ledger dan pembagian: LedgerEntry, saldo per pasangan (K25), largest remainder dengan tie-break userId (G4), BigInt (K7, K35)
- [ ] T1.7 Transaksi dan struk: DRAFT sampai submit, mode EQUAL_ALL, EQUAL_SUBSET, CUSTOM, unggah dan verifikasi struk (status FAILED dan alasan keputusan), ReceiptExtraction dan validasi aritmetika, deteksi duplikat (K8), metode pembayaran wajib saat submit (K26)
- [ ] T1.8 Persetujuan dan notifikasi: Approval dan suara (aturan 7.2, kuorum, kedaluwarsa tujuh hari), consent peserta (K23), Notification dalam aplikasi, GET /me/summary
- [ ] T1.9 Pembayaran: metode pembayaran, pelunasan bilateral dengan bukti (confirm, reject, cancel), saldo dan rincian per kreditur, riwayat bulanan dan pribadi (K24)
- [ ] T1.10 Kesiapan sebar: Dockerfile, /health/ready, graceful shutdown, CORS produksi ketat (K49), trust proxy dan opsi enkripsi Azure lewat env
- [ ] T1.11 Newman dengan assertion: koleksi Postman diperbarui mengikuti kontrak dan dijalankan di CI

Frontend (PIC: Aqidatul)
- [ ] F1.1 Modul klien API: header, Idempotency-Key, problem+json, lapisan mock sesuai kontrak
- [ ] F1.2 Akun: daftar, masuk, profil, ganti kata sandi
- [ ] F1.3 Beranda dan grup: daftar, buat, gabung lewat kode, detail dan anggota
- [ ] F1.4 Transaksi: buat DRAFT, unggah dan verifikasi struk, kirim, daftar per bulan, detail
- [ ] F1.5 Persetujuan dan notifikasi: daftar dan beri suara, consent peserta, kotak masuk, lencana
- [ ] F1.6 Saldo dan pelunasan: ringkasan, rincian per kreditur, metode pembayaran, kirim pelunasan dengan bukti, konfirmasi
- [ ] F1.7 Riwayat bulanan dan pribadi

### Acceptance criteria
- [ ] prisma migrate reset pada kontainer SQL Server baru berhasil, dan prisma generate berhasil
- [ ] Tes integrasi: UPDATE dan DELETE pada LedgerEntry, AuditLog, dan ReceiptExtraction ditolak trigger
- [ ] Tes integrasi: CHECK pada LedgerEntry menolak baris yang melanggar aturan (sisi ganda, amount nol, debitur sama dengan kreditur)
- [ ] CI hijau menjalankan tes unit dan tes integrasi terhadap SQL Server, ditambah job frontend (typecheck dan build)
- [ ] Tes: setiap respons non-2xx yang dapat dipicu bertipe application/problem+json
- [ ] Tes Idempotency-Key: permintaan ulang mengembalikan respons tersimpan dan tidak menulis ledger dua kali. Kunci sama dengan isi berbeda menghasilkan 409
- [ ] Tes acak: jumlah bagian pembagian rata selalu sama dengan total, selisih per orang paling banyak Rp1, dan jumlah seluruh saldo grup nol. Contoh: Rp70.000 untuk tiga peserta menjadi Rp23.334, Rp23.333, dan Rp23.333
- [ ] Tes jalur persetujuan: satu tes untuk tiap dari 10 kasus di architecture.md bagian 7.2
- [ ] Tes kuorum: contoh n sama dengan 1, 2, 3, 5, 6, 25, dan 40 untuk MAJORITY dan QUORUM_20 sesuai tabel di architecture.md bagian 4
- [ ] Tes saldo (K25): A menanggung Rp50.000 ke B dan B menanggung Rp20.000 ke A menghasilkan saldo Rp30.000. Setelah pelunasan Rp30.000 menjadi nol. Pelunasan melebihi yang dapat dibayar ditolak (409 amount-exceeds-debt), dan pelunasan PENDING ikut dihitung
- [ ] Tes duplikat struk: hash gambar sama menghasilkan 409 duplicate-receipt, dan isi mirip menghasilkan NEEDS_REVIEW
- [ ] Tes akses: non-anggota dan mantan anggota ditolak pada setiap rute berparameter groupId, dan respons grup tidak memuat email anggota
- [ ] Koleksi Newman dengan assertion hijau di CI untuk alur: buat grup, transaksi merata dengan struk lolos, saldo benar, pelunasan dikonfirmasi, saldo nol. Alur struk gagal (persetujuan admin), tanpa struk (mayoritas), dan subset (consent) juga hijau
- [ ] Image Docker berhasil dibuat dan dijalankan lokal. /health/ready benar, dan SIGTERM menutup server dengan bersih
- [ ] Frontend menjalankan alur utama dengan backend nyata, dibuktikan tangkapan layar tanpa secret
- [ ] Bukti dilampirkan di komentar penutup: tautan CI hijau dan tangkapan layar

### Dependency
Tahap 0 (dokumen di main). Instruksi Azure tidak dibutuhkan tahap ini.

### PIC
Rasyid (backend), Aqidatul (frontend).
<!-- issue:tahap-1:end -->

<!-- akhir-roadmap-1 -->

## 5. Tahap 2: Pembeda

<!-- issue:tahap-2:start -->
### Deskripsi
Pembeda produk: pemilihan item real-time dengan klaim atomik, revisi dan takedown, peran dan keluar-masuk anggota, sesi yang aman, dan pemulihan kata sandi. Sumber: docs/roadmap.md bagian 5.

### Deliverable
Backend (PIC: Rasyid)
- [ ] T2.0 Migration subset Tahap 2 (ItemClaim, ItemAssignment, TransactionRevision, GroupJoinRequest, GroupInvitation, GroupPaymentSetting, RefreshToken, AccountToken, EmailOutbox, kolom pengaturan grup)
- [ ] T2.1 Socket.IO: handshake dengan JWT, room grup dan pribadi, pencabutan koneksi saat keanggotaan berakhir (bagian 3 kontrak)
- [ ] T2.2 Pilih item: klaim atomik, HOLDING 12 jam dengan pengingat jam ke-10, Done, finalisasi oleh penalang atau sistem, penunjukan anggota, kunci klaim (K2, K14 sampai K18)
- [ ] T2.3 Revisi dan takedown (kontrak bagian 9.6 dan 9.7). Penghalang: spesifikasi revisi yang mengubah item pada transaksi ITEMIZED belum ditulis dan harus ditulis lebih dulu
- [ ] T2.4 Peran dan keanggotaan: OWNER, serah terima, pengaturan grup, rotasi kode, permintaan gabung, undangan, keluar dan dikeluarkan dengan penyelesaian otomatis (K28 sampai K31), pengaturan metode pembayaran grup
- [ ] T2.5 Sesi: refresh token dengan rotasi, dua mode transport, toleransi refresh bersamaan, logout (K46, K49)
- [ ] T2.6 Pemulihan kata sandi dengan outbox email, Mailpit untuk pengembangan (K50)
- [ ] T2.7 Event Socket.IO untuk modul Tahap 1 dinyalakan (persetujuan, transaksi, notifikasi, saldo, pelunasan)

Frontend (PIC: Aqidatul)
- [ ] F2.1 Klien Socket.IO dan penanganan putus-sambung
- [ ] F2.2 Kartu pilih item real-time, Done, penunjukan, tutup pembagian
- [ ] F2.3 Revisi dan takedown
- [ ] F2.4 Peran, anggota, undangan, permintaan gabung, keluar dan dikeluarkan, pengaturan grup
- [ ] F2.5 Refresh token single-flight dan dukungan dua mode (BODY dan COOKIE)
- [ ] F2.6 Halaman lupa dan reset kata sandi (token di fragmen URL)

### Acceptance criteria
- [ ] Tes konkurensi: 20 klaim paralel atas satu unit terakhir meloloskan tepat satu, 19 lainnya mendapat 409 item-unavailable, dan claimedQty sama dengan qty
- [ ] Tes: HOLDING yang melewati 12 jam dilepas saat ada klaim lain, dan pengingat jam ke-10 terkirim
- [ ] Tes biaya item: contoh di kontrak 7.2 lolos. Nasi Goreng dan Es Teh menghasilkan Rp27.500 dan Rp5.500 per unit, dan ongkir Rp5.000 untuk tiga pengklaim menjadi Rp1.667, Rp1.667, dan Rp1.666
- [ ] Tes: finalisasi melepas HOLDING, membatalkan penunjukan OFFERED, dan menulis ongkir. Setelah FINALIZED, mengubah klaim menghasilkan 409
- [ ] Tes penunjukan: penerima pertama menang, lainnya CANCELLED, dan unit yang sudah diambil orang lain menghasilkan 409. Klaim terkunci (K2) menghasilkan 409 claim-locked
- [ ] Tes Socket.IO: handshake dengan token salah ditolak, event hanya diterima anggota room yang benar, dan anggota yang keluar dicabut dari room
- [ ] Tes revisi: baseVersion usang menghasilkan 409. Kenaikan tanggungan meminta consent ulang, kenaikan yang ditolak ditanggung penalang (K22), dan takedown membalik CHARGE serta menghasilkan kredit
- [ ] Tes peran: OWNER tidak dapat dikeluarkan atau diturunkan, serah terima atomik, dan admin tidak dapat mengeluarkan admin. Semua penghalang keluar teruji, termasuk override dengan alasan, dan penyelesaian otomatis K31 teruji
- [ ] Tes undangan dan gabung: pembuatan undangan selalu 202, daftar email disamarkan, jeda 24 jam berlaku, dan dua orang yang bergabung bersamaan pada anggota ke-50 hanya meloloskan satu
- [ ] Tes refresh: rotasi berjalan, pemakaian ulang setelah lebih dari 10 detik mencabut keluarga token, dan dalam 10 detik menghasilkan 409 refresh-conflict tanpa mencabut. Mode BODY dan COOKIE sama-sama teruji
- [ ] Tes pemulihan kata sandi: respons selalu 202, token sekali pakai dan kedaluwarsa satu jam, dan semua refresh token dicabut setelah reset
- [ ] CI hijau, Newman diperluas untuk alur pilih item dan revisi
- [ ] Frontend menjalankan pilih item real-time dengan dua perangkat atau dua tab, dibuktikan tangkapan layar atau rekaman tanpa secret

### Dependency
Tahap 1 selesai.

### PIC
Rasyid (backend), Aqidatul (frontend).
<!-- issue:tahap-2:end -->

## 6. Tahap 3: Pendukung

<!-- issue:tahap-3:start -->
### Deskripsi
Fitur pendukung: chat grup, dana kelompok, pengingat utang lewat email, dan ganti email. Sumber: docs/roadmap.md bagian 6.

### Deliverable
Backend (PIC: Rasyid)
- [ ] T3.0 Migration subset Tahap 3 (GroupChat, Message, ChatReadState, GroupFund, FundEntry, Reminder, kolom activeSince)
- [ ] T3.1 Chat: nomor urut per grup tanpa celah (K38), jendela activeSince (K39), pesan teks dan gambar, kartu sistem (K40), batas laju dan sanitasi (K41), status dibaca
- [ ] T3.2 Dana kelompok: penunjukan dan serah terima pemegang, setoran, penandaan dibayar dana, pelunasan atas nama dana, penutupan (K34 sampai K37)
- [ ] T3.3 Pengingat utang dengan outbox email dan pengirim SMTP (K27)
- [ ] T3.4 Ganti email dengan konfirmasi ke alamat baru (K51)

Frontend (PIC: Aqidatul)
- [ ] F3.1 Chat: pesan, gambar, kartu sistem, penanda belum dibaca
- [ ] F3.2 Dana kelompok: info, setoran, tandai transaksi, penutupan
- [ ] F3.3 Pengingat utang
- [ ] F3.4 Ganti email dan halaman konfirmasi

### Acceptance criteria
- [ ] Tes konkurensi chat: 50 pengirim paralel menghasilkan nomor urut tanpa celah dan tanpa duplikat, dan urutan commit sama dengan urutan nomor
- [ ] Tes jendela pesan: pesan sebelum activeSince tidak muncul. Contoh belum dibaca: lastSeq 120, penanda 115, dua pesan milik sendiri menghasilkan 3
- [ ] Tes unggah gambar chat: SVG ditolak (415), lebih dari 5 MB ditolak (413), dan tipe ditentukan dari byte awal
- [ ] Tes kartu: satu kartu per subjek, dan transaksi yang gagal tidak meninggalkan kartu
- [ ] Tes dana (K35): dana penuh, dana sebagian (saldo Rp40.000, sisa Rp60.000 menjadi Rp15.000 per orang), sisa yang tidak habis dibagi (Rp69.999 menjadi Rp17.500, Rp17.500, Rp17.500, dan Rp17.499), pemegang yang juga penalang, takedown, dan pengembalian Rp33.334, Rp33.333, Rp33.333
- [ ] Tes: dua penandaan dana bersamaan tidak memakai saldo yang sama
- [ ] Tes: nama pemegang dana tidak muncul untuk anggota biasa di semua respons dana
- [ ] Tes pengingat: permintaan dalam jeda 12 jam menghasilkan 429, dan yang keempat dalam satu siklus menghasilkan 409 reminder-limit
- [ ] Tes ganti email: token sekali pakai, email berganti hanya setelah konfirmasi, dan semua refresh token dicabut
- [ ] CI hijau dan Newman diperluas
- [ ] Frontend menjalankan chat dan dana dengan backend nyata, dibuktikan tangkapan layar tanpa secret

### Dependency
Tahap 2 selesai. Layanan email produksi belum ada: alur email hanya berjalan lokal sampai diputuskan.

### PIC
Rasyid (backend), Aqidatul (frontend).
<!-- issue:tahap-3:end -->

<!-- akhir-roadmap-2 -->

## 7. Tahap 4: Pengerasan

<!-- issue:tahap-4:start -->
### Deskripsi
Pengerasan: hapus akun, logging, job pembersih, header keamanan, dan migrasi bertahap ke TypeScript. Sumber: docs/roadmap.md bagian 7.

### Deliverable
Backend (PIC: Rasyid)
- [ ] T4.1 Hapus akun lewat anonimisasi (K52)
- [ ] T4.2 Logging terstruktur dengan pino, tanpa secret, token, atau data pribadi
- [ ] T4.3 Job pembersih: blob yatim, token kedaluwarsa, dan evaluasi cadangan untuk hold, persetujuan, dan undangan yang kedaluwarsa
- [ ] T4.4 Keamanan HTTP: helmet, CORS produksi yang menolak tanda bintang, trust proxy diuji dengan header, dan tinjauan batas laju
- [ ] T4.5 Migrasi bertahap ke TypeScript: utils, lalu services, lalu sisanya, dengan tes sebagai jaring pengaman

Frontend (PIC: Aqidatul)
- [ ] F4.1 Hapus akun, termasuk tampilan penghalang
- [ ] F4.2 Lint dan tes frontend di CI

### Acceptance criteria
- [ ] Tes hapus akun: setiap penghalang (OWNER, pemegang dana, saldo tidak nol, pelunasan PENDING) menolak. Setelah berhasil, email dan nama anonim, ledger utuh, dan email lama dapat didaftarkan ulang
- [ ] Tes log: keluaran log pada alur login, reset kata sandi, dan unggah tidak memuat password, token, atau nomor rekening
- [ ] Tes job pembersih menghapus blob yatim dan token kedaluwarsa
- [ ] Tes konfigurasi: lingkungan produksi dengan CORS berisi tanda bintang menolak start
- [ ] TypeScript: typecheck hijau di CI, dan semua tes yang ada tetap hijau pada setiap langkah migrasi
- [ ] Bukti dilampirkan di komentar penutup

### Dependency
Tahap 3 selesai.

### PIC
Rasyid (backend), Aqidatul (frontend).
<!-- issue:tahap-4:end -->

## 8. Tahap 5: Terakhir

<!-- issue:tahap-5:start -->
### Deskripsi
Chatbot dan penyebaran Azure. Sumber: docs/roadmap.md bagian 8. Penyebaran Azure menunggu instruksi asisten praktikum dan belum ada instruksinya.

### Deliverable
- [ ] T5.1 Chatbot read-only: hanya data grup tempat penanya menjadi anggota, otorisasi di kode, nomor rekening tidak masuk konteks, teks struk dan chat diperlakukan sebagai data (PIC: Rasyid dan Bintang)
- [ ] T5.2 Persiapan Azure: koneksi terenkripsi ke Azure SQL, Blob, Key Vault, App Service dengan WebSocket aktif, dan App Insights. Memutuskan mode refresh token sesuai domain penyebaran (PIC: Rasyid)
- [ ] T5.3 Integrasi model tahap 1 dari AI Engineer bila siap (K lintas B) (PIC: Bintang dan Rasyid)
- [ ] T5.4 Rotasi secret sebelum demo publik (issue lintas C) (PIC: Rasyid)
- [ ] F5.1 Layar chatbot (PIC: Aqidatul)

### Acceptance criteria
- [ ] Tes chatbot: pengguna A tidak dapat memperoleh data grup tempat ia bukan anggota, konteks tidak pernah memuat nomor rekening (diuji dengan nomor sentinel), dan instruksi yang disisipkan di teks struk atau chat tidak mengubah otorisasi. Chatbot tidak dapat melakukan aksi tulis
- [ ] Koneksi Azure SQL memakai encrypt true dan trustServerCertificate false
- [ ] Smoke test pada URL publik: daftar, masuk, buat transaksi, dan WebSocket tersambung
- [ ] Mode refresh token dipilih dan dicatat di architecture.md bersama alasannya
- [ ] Tidak ada secret di riwayat repository (periksa dan lampirkan hasilnya)
- [ ] Bukti dilampirkan di komentar penutup

### Dependency
Tahap 4 selesai untuk bagian pengerasan. Instruksi dan izin dari asisten praktikum untuk Azure (belum ada). Kontrak AI (issue lintas B).

### PIC
Rasyid (utama), Bintang (AI), Aqidatul (frontend).
<!-- issue:tahap-5:end -->

## 9. Lintas A: Sinkronisasi dokumen dan laporan

<!-- issue:lintas-a:start -->
### Deskripsi
Menyelaraskan materi proyek dengan keputusan terbaru. Sumber: docs/roadmap.md bagian 9.

### Deliverable
- [ ] site/index.html tidak lagi menyebut login lewat No. HP (tabel fitur dan FR 1) (PIC: Rasyid)
- [ ] Gambar Lean Canvas di site/assets diperbarui (PIC: Aqidatul dan tim)
- [ ] Gambar ERD di site/assets diperbarui mengikuti ERD v2 (PIC: Aqidatul dan tim)
- [ ] Laporan progres memuat deviasi dengan jujur: Gemini sementara merangkap tahap pemfilter, No. HP dibatalkan, real-time dihidupkan kembali, cakupan fitur diperluas, saldo per pasangan menggantikan netting multilateral (PIC: Rasyid)
- [ ] Isu #15 dan #18 dicatat "Selesai (inti), tindak lanjut tercatat". Tindak lanjutnya tercakup di Tahap 1 (saldo dari ledger dan CHARGE hanya setelah transaksi lolos) (PIC: Rasyid)

### Acceptance criteria
- [ ] pencarian "HP" dan "telepon" di site/ tidak menemukan klaim login lewat nomor HP
- [ ] Gambar Lean Canvas dan ERD terbaru ter-commit
- [ ] Laporan memuat daftar deviasi dan tautan ke bukti tiap isu
- [ ] Bukti dilampirkan di komentar penutup

### Dependency
Tidak ada. Gambar ERD mengikuti architecture.md bagian 6.

### PIC
Tim: Rasyid, Aqidatul, Bintang.
<!-- issue:lintas-a:end -->

## 10. Lintas B: Kontrak AI dan akurasi resmi

<!-- issue:lintas-b:start -->
### Deskripsi
Menyepakati kontrak verifikasi struk antara backend dan AI Engineer, dan menghitung akurasi resmi. Sumber: docs/roadmap.md bagian 10. Sampai kontrak ada, Gemini merangkap tahap pemfilter dan tahap baca isi.

### Deliverable
- [ ] Kontrak tahap pemfilter: format keluaran, misalnya { isReceipt, confidence }, dan cara model disajikan (layanan HTTP, berkas model, atau lainnya) (PIC: Bintang)
- [ ] Format hasil baca isi struk: item (nama, jumlah, harga satuan, subtotal), subtotal, diskon, service charge, ongkir, PPN beserta eksklusif atau inklusif, total, merchant, tanggal dan jam, confidence (PIC: Bintang dan Rasyid)
- [ ] Bentuk GET .../extraction di kontrak API ditulis berdasarkan format di atas (PIC: Rasyid)
- [ ] Set uji berlabel dari dataset struk (PIC: Bintang)
- [ ] Angka akurasi resmi dihitung dari set uji (PIC: Bintang)

### Acceptance criteria
- [ ] Kontrak tertulis dan disetujui kedua pihak, dan api-contract.md bagian 9.3 diperbarui
- [ ] Set uji berlabel tersedia dan lokasinya tercatat
- [ ] Angka akurasi dilaporkan beserta cara menghitungnya. Sampai ada, laporan tidak menyebut angka akurasi
- [ ] Bukti dilampirkan di komentar penutup

### Dependency
Dataset struk dari Bintang. Tahap 1 untuk uji coba integrasi.

### PIC
Bintang. Rasyid untuk sisi integrasi.
<!-- issue:lintas-b:end -->

## 11. Lintas C: Rotasi secret

<!-- issue:lintas-c:start -->
### Deskripsi
Mengganti kredensial yang pernah terekspos dan memastikan tidak ada secret di repository, sebelum demo publik. Sumber: docs/roadmap.md bagian 11.

### Deliverable
- [ ] GEMINI_API_KEY yang pernah tertempel di percakapan diganti (PIC: Rasyid)
- [ ] Kredensial proyek lain (PassGo) yang pernah tampil diganti di luar repository ini (PIC: Rasyid)
- [ ] Riwayat repository diperiksa tidak memuat secret, dan tidak ada berkas .env yang ter-commit (PIC: Rasyid)

### Acceptance criteria
- [ ] Kunci lama dicabut atau diganti di penyedia masing-masing
- [ ] Pemeriksaan riwayat repository dilakukan dan hasilnya dicatat tanpa menampilkan secret
- [ ] Bukti dilampirkan di komentar penutup, tanpa nilai secret

### Dependency
Dilakukan sebelum demo publik. Tidak menahan tahap lain.

### PIC
Rasyid.
<!-- issue:lintas-c:end -->

## 12. Risiko dan garis potong

| Risiko | Penjelasan | Penanganan |
|---|---|---|
| Penyebaran terdesak | Gantt di site/index.html menjadwalkan deployment dan delivery akhir di pertemuan 11 sampai 12, dan Azure SQL dan Blob wajib. Azure berada di tahap terakhir, dan asisten belum memberi instruksi | Kesiapan sebar masuk Tahap 1 (T1.10). Instruksi asisten ditanyakan sekarang |
| Layanan email produksi belum ada | Pemulihan kata sandi, ganti email, dan pengingat hanya berjalan lokal | Putuskan bersama instruksi Azure |
| Aqidatul memulai frontend bersamaan dengan backend | Backend lama belum sesuai kontrak | Lapisan mock sesuai kontrak (F1.1) |
| Spesifikasi revisi item ITEMIZED belum ditulis | Menghalangi T2.3 | Ditulis lebih dulu di api-contract.md |
| Kontrak AI belum ada | Bentuk GET .../extraction belum final | Lintas B |

Garis potong. Bila waktu habis di tengah jalan, yang diserahkan tetap produk utuh pada tahap terakhir yang selesai:
- Berhenti setelah Tahap 1: aplikasi pencatat patungan lengkap dengan verifikasi struk, persetujuan, ledger, dan pelunasan. Itu inti nilai jual dan produk utuh.
- Pengecualian yang tidak boleh dilewati walau Tahap 4 dipotong: CORS ketat, trust proxy, dan opsi enkripsi Azure. Ketiganya sudah ada di T1.10.

## 13. Perubahan urutan dari rencana awal

| Rencana awal | Sekarang | Alasan |
|---|---|---|
| Tes integrasi dengan SQL Server di Tahap 4 | Awal Tahap 1 (T1.2) | Klaim atomik, trigger append-only, filtered unique index, kunci baris, dan CHECK hanya terbukti terhadap SQL Server nyata. CI sebelumnya hanya menjalankan npm test tanpa database dan tanpa job frontend |
| Newman dengan assertion di Tahap 4 | Tahap 1 (T1.11) | Koleksi Postman tanpa assertion berarti bukti manual |
| Dockerfile, /health/ready, graceful shutdown di Tahap 4 | Akhir Tahap 1 (T1.10) | Tiap tahap berakhir dengan produk yang dapat dijalankan |
| Pencatatan riwayat menyeluruh belum dijadwalkan | Fondasi Tahap 1 (T1.3) | Berlaku sejak endpoint pertama |
| Batas laju gabung, login, daftar di Tahap 4 | Tahap 1 | K32 dan K47 |
| Migration pertama di Tahap 0 | Item pertama Tahap 1 (T1.1), dan dipecah per tahap | Tahap 0 dapat ditutup dengan bukti dokumen. Tabel hanya dibuat pada tahap yang memakainya |
| Socket.IO di Tahap 2 | Tetap Tahap 2 | Event modul Tahap 1 dinyalakan di T2.7. Sebelum itu klien mengambil ulang lewat REST |

<!-- akhir-roadmap -->

## 14. Daftar issue

Issue dibuat dari bagian berpenanda di dokumen ini menggunakan template Task. Issue anak per modul (misalnya T1.1) dibuat saat tahapnya dimulai, berjudul dengan kode modul, diberi label tahap yang sesuai, dan dirujuk dari checklist issue tahap.

| Nomor | Issue | Label |
|---|---|---|
| #41 | Tahap 0: Penutupan rancangan | tahap-0, documentation |
| #42 | Tahap 1: Inti nilai jual | tahap-1 |
| #43 | Tahap 2: Pembeda | tahap-2 |
| #44 | Tahap 3: Pendukung | tahap-3 |
| #45 | Tahap 4: Pengerasan | tahap-4 |
| #46 | Tahap 5: Chatbot dan penyebaran Azure | tahap-5 |
| #47 | Lintas A: Sinkronisasi dokumen dan laporan | lintas, documentation |
| #48 | Lintas B: Kontrak AI dan akurasi resmi | lintas |
| #49 | Lintas C: Rotasi secret sebelum demo publik | lintas |

### 14.1 Aturan sumber

1. Dokumen ini adalah sumber definisi (isi tahap, deliverable, acceptance criteria). Issue adalah sumber status (kotak yang dicentang).
2. Perubahan definisi dilakukan di dokumen ini dan di issue yang bersangkutan, dengan tangan lewat halaman issue. Isi issue tidak ditimpa dengan perintah gh issue edit --body-file, karena itu menghapus centang yang sudah ada.
3. Kotak dicentang hanya bila buktinya terlampir (aturan 2 dan 3 di bagian 1).

### 14.2 Issue lama dan kaitannya

Tidak ada issue lama yang ditutup. Penutupan hanya dengan bukti tes.

| Issue lama | Pemilik | Kaitan | Catatan |
|---|---|---|---|
| #12 Konfigurasi Azure Database (SQL) | Rasyid | T5.2 di #46 | Menunggu instruksi dan izin asisten praktikum |
| #13 Konfigurasi Azure Blob Storage | Rasyid | T5.2 di #46 | Sama dengan #12 |
| #16 Fine-tuning YOLOv8 dan evaluasi akurasi | Bintang | #48 dan T5.3 di #46 | Kontrak keluaran model perlu disepakati |
| #17 Antarmuka webapp mobile | Aqidatul | Item F di #42 sampai #45 | Payung frontend. Ditutup setelah semua item F selesai dan terbukti |
| #19 Menghubungkan frontend ke Azure Storage/DB | Aqidatul | F1.1 di #42 dan T5.2 di #46 | Frontend hanya memakai API backend. Judul perlu disesuaikan (menunggu persetujuan) |
| #20 Pengujian fungsional sistem | Rasyid | Acceptance criteria #42 sampai #46, T1.2, T1.11 | Payung pengujian akhir |
| #21 Audit keamanan sistem dan data | Rasyid | T4.4 di #45 dan #49 | Berdasar architecture.md K42 sampai K52 |
| #22 Memperbaiki bug hasil testing | Rasyid | Setelah #20 | Belum ada perubahan |
| #23 Build aplikasi versi final | Tim | T5.2 di #46 | Perlu dikonfirmasi: APK atau PWA yang disebarkan di web |
| #15 dan #18 (tertutup) | Rasyid | #42 | Tindak lanjut tercakup di Tahap 1: saldo dari ledger, dan CHARGE hanya setelah transaksi lolos |

<!-- akhir-roadmap-daftar -->

## 15. Strategi pengembangan Tahap 1 dan database lokal

Keputusan 11 Oktober 2026.

### 15.1 Strategi merge

1. Backend v2 dikembangkan di branch 545518 dan digabung ke main hanya setelah acceptance criteria Tahap 1 (issue 42) terpenuhi. Sampai saat itu main berisi backend v1 yang berfungsi.
2. Titik kembali: tag backend-v1 menunjuk ke commit 8afe815 (merge PR 50), yaitu backend v1 beserta dokumen rancangan. Tag ini ringan (tanpa anotasi) karena tag beranotasi membawa identitas pembuat dan ditolak GitHub (GH007). Bila Tahap 1 tidak selesai, yang diserahkan adalah backend v1.
3. CI hanya berjalan pada push ke main dan dev serta pull request ke main dan dev. Selama Tahap 1 dipakai draft PR dari 545518 ke main supaya CI berjalan pada setiap push.
4. Alasan: kontrak API berubah total (pembungkus data, format error, bentuk auth, id), dan menukar skema membuat endpoint v1 berhenti berfungsi sampai ditulis ulang. Tes yang ada hanya menguji fungsi murni, jadi CI tetap hijau walau endpoint rusak. Menggabungkan perubahan skema ke main tanpa menulis ulang endpoint akan menghasilkan hijau palsu.
5. Harga yang dibayar: kemajuan Tahap 1 tidak terlihat di main sampai selesai, dan pekerjaan Tahap 1 yang belum selesai tidak ikut diserahkan bila waktu habis.
6. Perubahan dokumen yang berdiri sendiri dibuat dari branch pendek yang dipecah dari main, bukan dari 545518, supaya tidak membawa kode Tahap 1 yang belum selesai.

### 15.2 Database lokal

1. Pengembangan v2 memakai database patunganku_v2 pada kontainer yang sama. Database patunganku (data uji dan bahan bukti v1) tidak disentuh.
2. Larangan: docker compose down -v, prisma migrate reset --force terhadap patunganku, dan mengubah .env ke patunganku_v2 sebelum migration v2 siap.
3. Menjalankan v1 untuk bukti laporan: checkout tag backend-v1 dan atur DB_NAME serta database pada DATABASE_URL ke patunganku.
4. Database patunganku baru dihapus setelah laporan selesai dan atas keputusan eksplisit.

### 15.3 Koordinasi frontend

1. Aqidatul menyebut sedang mencoba mengintegrasikan frontend ke backend (percakapan 9 Oktober 2026). Seberapa jauh integrasinya belum diverifikasi.
2. Selama Tahap 1, main tetap v1 yang stabil. Bentuk respons v1 berubah di v2 (api-contract bagian 4 dan 5).
3. Seluruh pemanggilan API frontend sebaiknya berada di satu modul klien (F1.1) agar peralihan ke v2 hanya mengubah satu tempat.

### 15.4 Identitas Git dan privasi email

1. GitHub dapat memblokir push yang mengekspos email privat (galat GH007). Atur git config user.email ke alamat noreply akun GitHub masing-masing (Settings, Emails), hanya untuk repo ini bila ada proyek lain di mesin yang sama.
2. Tag beranotasi membawa identitas pembuat dan ikut ditolak. Gunakan tag ringan, yaitu git tag nama commit.
3. Riwayat yang sudah ada tidak ditulis ulang, karena riwayat main dipakai bersama dan salinannya sudah tersebar. Commit lama memuat email yang dipakai saat dibuat, dan itu dapat dilihat di repositori publik. Pemilik email masing-masing dapat meninjau keputusan ini.

<!-- akhir-roadmap-strategi -->
