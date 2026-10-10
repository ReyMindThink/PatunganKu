# Arsitektur PatunganKu

Dokumen ini adalah sumber kebenaran desain backend. Setiap perubahan skema, state machine, atau aturan bisnis diperbarui di sini lebih dulu, baru ke kode.

Status: Tahap 0 (rancangan). Migration belum ditulis. Versi dokumen: 2.

## 1. Tujuan dan ruang lingkup

PatunganKu adalah aplikasi pencatat dan pembagi pengeluaran grup (kos, KKN, open trip). Foto struk diverifikasi AI sebelum nominalnya masuk ke tagihan.

Batas produk:

- PatunganKu hanya pencatat dan penunjuk. Uang tidak melewati sistem. Integrasi payment gateway (misalnya Midtrans atau QRIS) sengaja tidak dibuat dan dicatat sebagai pekerjaan lanjutan.
- Autentikasi memakai email dan password saja. Nomor HP dibatalkan.
- Stiker dibatalkan. Chat hanya teks, gambar, dan emoji Unicode standar.

## 2. Prinsip desain

1. Ledger append-only. Setiap tanggungan, pelunasan, dan koreksi adalah baris baru di LedgerEntry. Baris tidak pernah diubah atau dihapus. Saldo selalu dihitung dari penjumlahan entri, bukan disimpan.
2. Alur kerja dan ledger dipisah. Status persetujuan, klaim, dan konsensus berada di tabel kerja yang boleh berubah. Ledger hanya ditulis ketika sebuah tanggungan resmi berlaku.
3. Riwayat tidak bisa diedit siapa pun. AuditLog dan Message juga append-only. Revisi mencatat nilai lama, nilai baru, pelaku, waktu, dan alasan wajib.
4. Uang adalah bilangan bulat rupiah. LedgerEntry.amount bertipe BigInt. Konversi ke Number hanya di batas service, dengan pengecekan rentang aman. Tidak ada aritmetika float untuk uang, termasuk kuorum (pakai bilangan bulat).
5. Otorisasi dilakukan di kode, bukan di prompt. Ini berlaku juga untuk chatbot.
6. Pembagian rupiah memakai metode largest remainder. Total tanggungan selalu persis sama dengan total struk, selisih per orang maksimal Rp1. Tie-break pecahan sama besar: userId menaik, agar hasil deterministik dan bisa dites.
7. Klaim item atomik di database, bukan di aplikasi (lihat bagian ERD).
8. Anggota tidak pernah dihapus. GroupMember memakai status ACTIVE, LEFT, atau REMOVED dengan leftAt, karena ledger masih merujuknya.

## 3. Keputusan produk final

Keputusan di bawah sudah disetujui dan tidak ditanyakan ulang.

| No | Keputusan |
|---|---|
| 1 | OWNER adalah admin yang tidak bisa diturunkan atau dikeluarkan admin lain. Hanya OWNER yang mengangkat atau menurunkan admin dan memindahkan kepemilikan. OWNER tidak bisa keluar sebelum menyerahkan kepemilikan. Pembuat grup otomatis OWNER. Di UI tampil sebagai Admin. |
| 2 | Grup satu anggota, atau pengaju tanpa pemilih: langsung disetujui dan hanya dicatat. |
| 3 | Admin yang juga penalang: persetujuan oleh admin lain. Jika admin tunggal, berlaku aturan 20% pemilih. |
| 4 | Revisi yang menaikkan tanggungan seseorang: orang itu wajib setuju ulang. Yang lain cukup diberi pemberitahuan. |
| 5 | Pilihan item terkunci setelah ada pelunasan terkonfirmasi untuk pasangan pengutang-penalang. Dipersempit oleh K2 (bagian 5). |
| 6 | Item belum terpilih setelah 24 jam: penalang menunjuk satu atau beberapa anggota. Yang pertama menerima mendapat item (atomik), sisanya otomatis batal. Jika semua menolak, penalang boleh mengambilnya sendiri. |
| 7 | Mantan anggota yang masih berutang atau dipiutangi tampil sebagai mantan anggota di ledger sampai lunas, tanpa akses chat. Metode pembayarannya tetap terlihat oleh pihak yang bertransaksi. |
| 8 | Gabung hanya lewat kode grup. Admin boleh mengundang email, dan undangan harus diterima penerimanya (K29). Admin mengatur: sembunyikan kode dari anggota biasa, dan gabung butuh persetujuan atau tidak. |
| 9 | Dana kelompok hanya untuk transaksi mode MERATA. Tampil sebagai Dana Kelompok untuk semua anggota. Hanya admin dan pemegang dana yang melihat nama di pengaturan dana. Hanya pemegang dana yang menambah dana, tiap penambahan mencatat keterangan sumber. Pengecualian yang diterima ada di bagian 8. |
| 10 | Pelunasan dicatat per pasangan pengutang-kreditur, bukan per transaksi. Formulir berisi nominal, metode, bukti (kecuali tunai), lalu disetujui kreditur. |
| 11 | Stiker dibatalkan. |
| 12 | Gambar chat maksimal 5 MB, tipe divalidasi dari byte awal seperti struk. |

Keputusan lanjutan dari Tahap 0:

| Kode | Keputusan |
|---|---|
| G1 | Pada mode PER ITEM, ongkir dibagi merata hanya ke anggota yang punya minimal satu item berstatus Done. |
| G2 | Jumlah pemilih untuk kuorum di-snapshot saat pengajuan dan disimpan di Approval.eligibleCount. Anggota yang masuk atau keluar sesudahnya tidak mengubah kuorum. |
| G3 | Database dev direset dan dimulai dari migrasi baru. Belum ada data produksi. |
| G4 | Tie-break largest remainder: userId menaik. |
| G5 | Takedown transaksi per item: klaim ditandai VOIDED, entri ledger dibalik lewat REVERSAL, riwayat tetap terlihat. |

## 4. Konstanta

Semua nilai ini disimpan di apps/backend/src/config/constants.js dan tidak ditulis langsung di kode.

| Konstanta | Nilai |
|---|---|
| Kedaluwarsa pengajuan persetujuan | 7 hari |
| Batas HOLDING klaim item | 12 jam |
| Pengingat HOLDING akan dilepas | pada jam ke-10 |
| Item belum terpilih, penalang diberi tahu | 24 jam |
| Jeda pengingat email per utang | 12 jam |
| Maksimal pengingat email per utang | 3 kali |
| Batas ukuran gambar (struk dan chat) | 5 MB |
| Batas anggota aktif per grup | 50 (usulan) |
| Kedaluwarsa permintaan gabung dan undangan | 7 hari |
| Jeda mengajukan gabung lagi setelah ditolak atau dikeluarkan | 24 jam |
| Batas percobaan gabung lewat kode | 10 per 15 menit per pengguna |
| Undangan tertunda per grup | maksimal 20 |
| Kedaluwarsa penunjukan pemegang dana | 7 hari |
| Panjang maksimal pesan chat | 2000 karakter Unicode |
| Batas pesan teks per pengguna per grup | 20 per menit (usulan) |
| Batas gambar chat per pengguna per grup | 5 per 5 menit (usulan) |
| Masa berlaku access token (setelah refresh token tersedia) | 15 menit (usulan) |
| Masa berlaku refresh token | 30 hari sejak login, tidak diperpanjang oleh rotasi (usulan) |
| Batas percobaan login | 10 per 15 menit per pasangan IP dan email, dan 50 per 15 menit per IP (usulan) |
| Batas pendaftaran akun | 10 per jam per IP (usulan) |
| Masa berlaku token reset kata sandi | 1 jam, sekali pakai |
| Masa berlaku token ganti email | 24 jam, sekali pakai (usulan) |
| Toleransi refresh bersamaan | 10 detik (usulan) |
| Batas pengiriman email reset per akun | 3 per jam, diam-diam (usulan) |
| Batas aksi sensitif akun | 5 per 15 menit per pengguna, satu hitungan bersama untuk ganti password, ganti email, dan hapus akun (usulan) |
| Kuorum merata (lebih dari 50% pemilih) | floor(n / 2) + 1 |
| Kuorum admin tunggal (20% pemilih) | min(5, max(1, ceil(n / 5))), dihitung dengan bilangan bulat |

Contoh kuorum, n adalah jumlah pemilih saat pengajuan:

| n | 1 | 2 | 3 | 5 | 6 | 25 | 40 |
|---|---|---|---|---|---|---|---|
| Merata, lebih dari 50% | 1 | 2 | 2 | 3 | 4 | 13 | 21 |
| Admin tunggal, 20% | 1 | 1 | 1 | 1 | 2 | 5 | 5 |

Catatan: untuk n = 0 (tidak ada pemilih), pengajuan langsung disetujui (keputusan 2).

<!-- akhir-bagian-3 -->

## 5. Koreksi desain Tahap 0

Bagian ini mencatat cacat yang ditemukan pada rancangan awal, termasuk beberapa yang berasal dari usulan asisten sendiri, beserta perbaikannya. Keputusan diubah karena alasan teknis, bukan dipertahankan karena sudah terlanjur. Semua koreksi di sini disetujui.

### K1. Dana kelompok adalah pseudo-akun di ledger

Masalah: pemegang dana (H) diperlakukan sebagai debitur biasa. Saldo pribadi H bercampur dengan kewajiban dana, netting bisa menutup utang pribadi H dengan uang dana, dan kebocoran identitas (bagian 8) makin lebar.

Perbaikan: dana menjadi pihak tersendiri di LedgerEntry. Kolom debtorFundId dan creditorFundId bersifat opsional, dan CHECK constraint memastikan tiap sisi (debitur, kreditur) berisi tepat satu dari user atau dana.

Contoh: struk Rp100.000 dibayar P, empat anggota, tanggungan awal Rp25.000 per anggota. Saat H menandai transaksi dibayar dana, CHARGE ketiga anggota lain ke P dibalik lewat REVERSAL, lalu ditulis CHARGE Dana ke P sebesar Rp100.000. FundEntry SPEND dicatat pada saat penandaan (dana dicadangkan), dan pengecekan saldo dana dilakukan atomik. H kemudian membayar P lewat SETTLEMENT Dana ke P, yang dikonfirmasi P seperti pelunasan biasa. Jika saldo dana tidak cukup, dana menutup sebesar saldonya dan sisanya dibagi merata dengan persetujuan pemegang dana.

### K2. Kunci pilihan item dipersempit

Masalah: aturan awal (keputusan 5) mengunci pilihan item di semua transaksi begitu ada pelunasan terkonfirmasi untuk pasangan pengutang-penalang. Pelunasan sebagian Rp10.000 pun akan mengunci transaksi lain, termasuk yang dibuat sesudahnya.

Perbaikan: yang terkunci hanya klaim dengan doneAt lebih awal atau sama dengan waktu konfirmasi pelunasan terakhir untuk pasangan tersebut. Klaim sesudahnya tetap bebas diubah.

### K3. Eksekusi pelunasan hanya bilateral

Masalah: rekomendasi greedy (commit 6a53829) bersifat multilateral. Pengguna A bisa diminta membayar C padahal tidak ada utang A ke C, sehingga pelunasannya tidak punya pasangan yang sah (bertabrakan dengan keputusan 10).

Perbaikan: pelunasan hanya antara dua pihak yang memang punya utang langsung. Tombol sederhanakan hanya menawarkan netting dua arah (A dan B yang saling berutang). Rekomendasi greedy lama tidak dipakai untuk eksekusi.

### K4. Ongkir pada mode PER ITEM memakai fase FINALIZE

Masalah: ongkir dibagi ke anggota yang punya item Done (G1). Jika dihitung langsung, setiap orang yang menekan Done mengubah bagian ongkir semua orang, dan ledger append-only akan penuh REVERSAL dan CHARGE ulang.

Perbaikan: biaya per unit item (termasuk PPN, diskon, dan service charge, dibagi proporsional dengan largest remainder) dihitung sekali dan CHARGE-nya tetap. Ongkir baru ditulis saat FINALIZE, yaitu ketika semua unit sudah terklaim atau penalang mengambil sisa unit (keputusan 6).

### K5. Perubahan DONE dan batas waktu HOLDING

Masalah: DONE sudah menulis CHARGE sehingga tidak boleh kembali ke HOLDING begitu saja. Selain itu HOLDING tanpa batas waktu bisa dipakai menahan unit dari anggota lain.

Perbaikan:
- Mengubah klaim yang sudah DONE ditulis sebagai REVERSAL ditambah CHARGE baru.
- HOLDING otomatis dilepas bila tidak menjadi DONE dalam 12 jam. Pengingat dikirim pada jam ke-10.
- Kedaluwarsa dievaluasi saat dipakai: pada transaksi database yang sama dengan klaim baru, hold yang sudah lewat 12 jam pada item itu dilepas lebih dulu, baru klaim atomik dicoba. Sistem tidak bergantung pada cron. Job pembersih tetap ada sebagai cadangan.

### K6. Konflik kepentingan pada revisi admin

Masalah: aturan awal hanya mengatur kasus admin yang juga penalang (keputusan 3). Admin bisa merevisi transaksi orang lain untuk mengecilkan bagiannya sendiri dan langsung berlaku.

Perbaikan: revisi apa pun yang mengubah tanggungan admin yang merevisi butuh persetujuan admin lain, atau aturan 20% pemilih bila admin tunggal.

### K7. Aritmetika uang

Masalah: SUM atas kolom Int di SQL Server bisa overflow di atas sekitar 2,147 miliar, dan ledger menjumlahkan banyak entri. Kuorum 20% yang dihitung dengan float rawan salah pembulatan.

Perbaikan: LedgerEntry.amount bertipe BigInt, dikonversi ke Number di batas service dengan pengecekan rentang aman. Kuorum 20% dihitung dengan bilangan bulat: ceil(n / 5), bukan 0,2 kali n. Batas nominal per transaksi ditetapkan di Tahap 0-1.

### K8. Deteksi struk ganda sebagai peringatan

Masalah: pencocokan isi (merchant, tanggal, total, jam) bisa menandai dua pembelian sah bernominal sama sebagai duplikat dan memblokir pengguna jujur.

Perbaikan: hash SHA-256 gambar yang identik diblokir. Kecocokan isi hanya peringatan yang butuh konfirmasi admin. Cakupan pencarian per grup, supaya tidak membocorkan struk lintas grup.

### K9. Jalur NEEDS_REVIEW dan mode ITEMIZED

Masalah: belum jelas apa yang terjadi bila AI gagal atau ragu pada mode PER ITEM. Kartu pilih item bisa terbit dari ekstraksi yang salah.

Perbaikan: status NEEDS_REVIEW mengikuti jalur struk gagal AI. Kartu pilih item hanya terbit setelah ekstraksi VERIFIED atau disetujui lewat aturan gagal AI. Mode ITEMIZED tanpa struk tidak diizinkan.

### K10. Dana kelompok: kontributor dan pemegang

Masalah: keterangan sumber saat top-up hanya teks bebas. Jika dana bubar atau pemegangnya keluar, tidak ada dasar mengembalikan sisa.

Perbaikan: FundEntry punya contributorId (opsional). Pemegang dana tidak bisa keluar sebelum menyerahkan dana, seperti OWNER. Sisa dana dikembalikan proporsional terhadap kontribusi.

<!-- akhir-bagian-5 -->

## 6. ERD v2

### Konvensi

- Model ditulis di Prisma. SQL Server tidak mendukung enum Prisma, jadi kolom status dan tipe berupa String (NVarChar). Nilai yang sah dijaga CHECK constraint di migration SQL mentah.
- Semua foreign key memakai onDelete NoAction, kecuali dinyatakan lain.
- Waktu disimpan UTC.
- Uang di LedgerEntry dan FundEntry bertipe BigInt. Uang di tabel lain bertipe Int rupiah, dibatasi CHECK sesuai batas nominal per transaksi.
- Tabel append-only (LedgerEntry, AuditLog, Message) dijaga trigger INSTEAD OF UPDATE dan INSTEAD OF DELETE yang melempar error. Trigger ditulis di migration SQL mentah karena Prisma tidak dapat menyatakannya.

### 6.1 Tabel yang sudah ada dan perubahannya

| Tabel | Kolom dan perubahan |
|---|---|
| User | id, email (unik), passwordHash, name, notifyByEmail (default false), createdAt. Kolom phone dihapus. |
| Group | id, name, code (unik), createdBy, createdAt. Tambah codeHidden (default false), joinRequiresApproval (default false). |
| GroupMember | id, groupId, userId, role (OWNER, ADMIN, MEMBER), status (ACTIVE, LEFT, REMOVED), joinedAt, activeSince, leftAt, leftReason. Unik (groupId, userId). Baris tidak pernah dihapus. Anggota yang bergabung kembali memakai baris yang sama (status kembali ACTIVE, riwayat di AuditLog). Filtered unique index: satu OWNER aktif per grup (role OWNER dan status ACTIVE). |
| Transaction | id, groupId, payerId (penalang), description, amount, mode (EQUAL_ALL, EQUAL_SUBSET, CUSTOM, ITEMIZED), status (DRAFT, PENDING_APPROVAL, ACTIVE, REJECTED, EXPIRED, WITHDRAWN, TAKEN_DOWN), receiptUrl, receiptStatus (PENDING, VERIFIED, FAILED, NEEDS_REVIEW), imageSha256, fingerprint, paidFromFund, fundCoveredAmount, version, expiresAt, itemsPhase (CLAIMING, FINALIZED), finalizedAt, finalizedBy, createdAt. Indeks (groupId, imageSha256) dan (groupId, fingerprint). |
| TransactionSplit | Dihapus, diganti TransactionShare. |
| TransactionShare | id, transactionId, userId, amount, consent (PENDING, ACCEPTED, REJECTED), consentAt. Unik (transactionId, userId). Ini tabel kerja (alur persetujuan), bukan ledger. |
| PaymentConfirmation | id, groupId, senderId, receiverId, amount, methodType (BANK, EWALLET, CASH), proofUrl, status (PENDING, CONFIRMED, REJECTED, CANCELLED), createdAt, decidedAt, cancelledAt. Bukti wajib kecuali CASH (divalidasi di service). Saat CONFIRMED menulis satu entri SETTLEMENT di ledger. |

Batas nominal per transaksi: MAX_TRANSACTION_AMOUNT di constants.js, ditegakkan di zod dan di CHECK database dengan nilai final Rp100.000.000.

### 6.2 Ledger dan audit

**LedgerEntry** (append-only)

| Kolom | Keterangan |
|---|---|
| id | Kunci utama. |
| groupId | Grup pemilik entri. |
| type | CHARGE, REVERSAL, SETTLEMENT. |
| sign | +1 atau -1. CHARGE selalu +1, SETTLEMENT selalu -1, REVERSAL berlawanan dengan entri yang dibalik. |
| amount | BigInt, selalu positif. |
| debtorUserId, debtorFundId | Sisi debitur. Tepat satu terisi. |
| creditorUserId, creditorFundId | Sisi kreditur. Tepat satu terisi. |
| category | GROUP (biaya merata) atau INDIVIDUAL (per item). |
| transactionId | Wajib untuk CHARGE. |
| paymentId | Wajib untuk SETTLEMENT. |
| reversesEntryId | Wajib untuk REVERSAL. |
| createdBy | Pelaku. |
| idempotencyKey | Opsional, unik terfilter. Mencegah entri ganda saat dobel-tap. |
| createdAt | Waktu. |

Aturan CHECK: amount lebih dari 0; sign hanya 1 atau -1; tepat satu sisi debitur dan satu sisi kreditur; debitur tidak sama dengan kreditur; syarat wajib per type seperti di tabel.

Saldo pasangan (debitur D, kreditur C) adalah SUM(sign x amount) atas entri dengan pasangan itu. Hasil positif berarti D berutang ke C. Hasil negatif berarti C berutang ke D, sehingga kelebihan bayar akibat takedown otomatis menjadi kredit tanpa tipe khusus. Saldo anggota total adalah penjumlahan atas semua pasangannya.

**AuditLog** (append-only)

id, groupId, actorId (kosong untuk sistem), transactionId (opsional), entity, entityId, action (misalnya REVISE, TAKEDOWN, OVERRIDE_LEAVE, ROLE_CHANGE, FUND_MARK), oldValue (JSON), newValue (JSON), reason, createdAt. Alasan wajib untuk REVISE, TAKEDOWN, dan OVERRIDE_LEAVE (ditegakkan di service). Indeks (groupId, createdAt). Selisih hasil AI dan revisi admin untuk data akurasi dibaca dari tabel ReceiptExtraction versi, bukan dari tabel terpisah.

### 6.3 Struk dan klaim item

**ReceiptExtraction** (satu baris per versi, tidak diubah)

id, transactionId, version, source (AI atau ADMIN), createdBy, merchant, purchasedAt, subtotal, discount, service, shipping, tax, taxMode (EXCLUSIVE, INCLUSIVE, UNKNOWN), total, confidence, arithmeticOk, rawJson, model, promptVersion, createdAt. Unik (transactionId, version). Versi aktif adalah versi tertinggi. Revisi admin membuat versi baru sehingga hasil asli AI tetap tersimpan. Jika taxMode UNKNOWN atau arithmeticOk salah, receiptStatus menjadi NEEDS_REVIEW.

**ReceiptItem**

id, extractionId, name, qty, unitPrice, subtotal, claimedQty, previousItemId (opsional, untuk pemetaan antar versi). CHECK: claimedQty antara 0 dan qty.

Klaim atomik dilakukan di satu pernyataan SQL:

    UPDATE ReceiptItem SET claimedQty = claimedQty + @q
    WHERE id = @id AND claimedQty + @q <= qty;

Jika jumlah baris terdampak 0, klaim ditolak. CHECK constraint menjadi pengaman kedua. Dalam transaksi yang sama, hold yang sudah lewat 12 jam pada item itu dilepas lebih dulu (K5).

Catatan terbuka: pemetaan klaim DONE ketika admin merevisi item di versi baru (lewat previousItemId, dengan REVERSAL dan CHARGE pada klaim terdampak) dirinci di docs/api-contract.md pada Tahap 1.

**ItemClaim**

id, itemId, userId, qty, status (HOLDING, DONE, RELEASED, VOIDED), holdExpiresAt, doneAt, createdAt. Unik (itemId, userId). Mengubah klaim DONE ditulis sebagai REVERSAL ditambah CHARGE baru (K5).

**ItemAssignment**

id, itemId, assigneeId, qty, offerGroupId, status (OFFERED, ACCEPTED, DECLINED, CANCELLED), offeredBy, offeredAt, decidedAt. Penerimaan pertama dilakukan atomik dengan UPDATE bersyarat. Kandidat lain otomatis CANCELLED (keputusan 6).

<!-- akhir-bagian-6a -->

### 6.4 Persetujuan, revisi, dan notifikasi

**Approval**

id, groupId, subjectType (TRANSACTION, REVISION), subjectId, rule, requestedBy, eligibleCount, required, status (OPEN, APPROVED, REJECTED, EXPIRED, CANCELLED), expiresAt, decidedAt, createdAt.

Nilai rule dan aturan keputusannya:

| rule | Pemilih yang sah | required | Cara memutuskan |
|---|---|---|---|
| ADMIN_ANY | Semua admin (OWNER dan ADMIN) aktif selain pengaju | 1 | Penentu tunggal: suara pertama langsung memutuskan (setuju atau tolak). |
| ADMIN_OTHER | Sama dengan ADMIN_ANY, dipakai bila pengaju adalah admin | 1 | Penentu tunggal. |
| QUORUM_20 | Semua anggota aktif selain pengaju | min(5, max(1, ceil(n / 5))) | Kuorum biasa. |
| MAJORITY | Semua anggota aktif selain pengaju | floor(n / 2) + 1 | Kuorum biasa. |

Aturan kuorum biasa: status menjadi APPROVED bila jumlah suara setuju mencapai required. Status menjadi REJECTED bila jumlah suara tolak sudah melebihi eligibleCount dikurangi required (kuorum mustahil tercapai). Status menjadi EXPIRED bila expiresAt lewat tanpa keputusan, dievaluasi saat Approval dibaca atau diberi suara (lazy), dengan job terjadwal sebagai cadangan.

Jika eligibleCount sama dengan 0, Approval tidak dibuat dan subjek langsung disetujui, dengan satu baris AuditLog (keputusan 2). eligibleCount adalah snapshot saat pengajuan (G2).

Pemilihan rule untuk transaksi dilakukan service sesuai tabel aturan persetujuan di spesifikasi produk. Transaksi mode ITEMIZED tidak memakai Approval, karena pilihan Done milik masing-masing anggota sudah merupakan persetujuan.

**ApprovalVote**

id, approvalId, userId, vote (APPROVE atau REJECT), votedAt. Unik (approvalId, userId). Service menolak suara dari pengaju dan dari pihak di luar pemilih yang sah.

**TransactionRevision** (tabel kerja)

id, transactionId, requestedBy, reason, payload (JSON usulan versi ekstraksi dan share baru), baseVersion (versi Transaction saat diajukan), status (PENDING_APPROVAL, APPLIED, REJECTED, EXPIRED), approvalId (opsional), appliedAt, createdAt.

- Revisi admin yang tidak menyentuh tanggungan admin itu sendiri berstatus APPLIED langsung dan menulis versi ReceiptExtraction baru, AuditLog, dan Notification.
- Revisi yang menyentuh tanggungan admin itu sendiri (K6), revisi oleh penalang non-admin sesudah distribusi, dan revisi admin yang juga penalang memakai Approval (ADMIN_OTHER, atau QUORUM_20 bila admin tunggal).
- Penerapan memeriksa baseVersion sama dengan Transaction.version (optimistic locking). Bila berbeda, revisi gugur dan harus diajukan ulang.
- Bagian yang tanggungannya naik kembali ke consent PENDING di TransactionShare (keputusan 4). Selama PENDING, CHARGE tambahan belum ditulis.

**Notification**

id, userId, groupId, type (misalnya APPROVAL_REQUEST, APPROVAL_DECIDED, REVISION_NOTICE, ITEM_UNCLAIMED, ITEM_OFFERED, HOLD_EXPIRING, PAYMENT_REQUEST, PAYMENT_DECIDED, REMINDER), payload (JSON), readAt, createdAt. Indeks (userId, readAt).

Pop-up "ada edit oleh ... pada ..." dibuat sebagai Notification bertipe REVISION_NOTICE untuk setiap anggota aktif grup.

**EmailOutbox** (pola outbox)

id, toUserId, template, payload (JSON), status (PENDING, SENT, FAILED), attempts, createdAt, sentAt. Pekerja kecil mengirim baris PENDING lewat SMTP (Mailpit untuk dev). Penulisan outbox berada dalam transaksi database yang sama dengan kejadian pemicunya.

### 6.5 Pembayaran dan dana kelompok

Koreksi atas bagian Konvensi: daftar tabel append-only yang berlaku adalah LedgerEntry, AuditLog, Message, FundEntry, dan ReceiptExtraction. Kelimanya dijaga trigger INSTEAD OF UPDATE dan INSTEAD OF DELETE.

**PaymentMethod**

id, userId, kind (BANK, EWALLET, CASH), provider, accountNo (dienkripsi di lapisan aplikasi dengan kunci dari konfigurasi, kelak Key Vault), accountName, isActive, createdAt. Setiap pengguna wajib punya minimal satu metode aktif (divalidasi di service). Nomor rekening hanya terlihat oleh pihak yang bertransaksi dengan pemiliknya, termasuk mantan anggota yang masih punya utang atau piutang (keputusan 7). Nomor rekening tidak pernah masuk konteks chatbot.

**GroupPaymentSetting**

groupId (unik), allowedKinds (string, kosong berarti semua metode di profil diterima).

**PaymentConfirmation** (tambahan kolom)

fundId (opsional). Terisi bila pelunasan dilakukan atas nama dana kelompok oleh pemegang dana. Entri SETTLEMENT yang dihasilkan memakai debtorFundId.

**GroupFund**

id, groupId (unik selama status bukan CLOSED), holderId (kosong sampai penunjukan diterima), pendingHolderId, status (PENDING, ACTIVE, CLOSED), createdBy, createdAt. Saldo dana adalah SUM atas FundEntry (TOPUP dan SPEND_REVERSAL bernilai positif, SPEND dan REFUND bernilai negatif).

**FundEntry** (append-only)

id, fundId, kind (TOPUP, SPEND, SPEND_REVERSAL, REFUND), amount (BigInt, selalu positif), contributorId (opsional, wajib untuk TOPUP), source (teks keterangan sumber, wajib untuk TOPUP), transactionId (wajib untuk SPEND), createdBy, createdAt.

Alur penandaan dibayar dana (K1):

1. Hanya pemegang dana yang dapat menandai, dan hanya untuk transaksi mode EQUAL_ALL berstatus ACTIVE.
2. Dalam satu transaksi database, baris GroupFund dikunci (UPDLOCK), saldo dihitung, lalu dana menutup sebesar min(saldo, total transaksi).
3. CHARGE para anggota dibalik (REVERSAL). Ditulis CHARGE dari Dana ke penalang sebesar bagian yang ditutup dana. Sisa yang tidak tertutup dibagi merata ke peserta transaksi setelah pemegang dana menyetujuinya secara eksplisit lewat acceptPartial (K34).
4. FundEntry SPEND ditulis sebesar bagian yang ditutup (dana dicadangkan).
5. Bila pemegang dana sekaligus penalang, tidak ada CHARGE dari Dana yang ditulis karena nilainya impas (pemegang sudah memegang kasnya), dan AuditLog (action FUND_MARK, selfReimbursed true) wajib dicatat (K35). Bila bukan, pemegang membayar penalang lewat PaymentConfirmation dengan fundId, yang dikonfirmasi penalang seperti pelunasan biasa.
6. Pemegang dana tidak bisa keluar dari grup sebelum menyerahkan dana ke pemegang baru atau menutup dana. Penutupan mengembalikan sisa proporsional terhadap kontribusi lewat FundEntry REFUND (K10).

### 6.6 Chat, pengingat, dan pendukung

**Message** (append-only)

groupId, seq (nomor urut per grup, mulai 1, tanpa celah, kunci utama bersama groupId), senderId (kosong untuk pesan sistem), kind (TEXT, IMAGE, SYSTEM_CARD), body (maksimal 2000 karakter Unicode, kolom NVarChar(4000)), imageBlob, imageMime, imageSize (hanya untuk IMAGE), cardType (ITEM_PICK atau APPROVAL), cardRef (id subjek kartu), createdAt. Unik (groupId, cardType, cardRef) untuk SYSTEM_CARD. Indeks (groupId, seq) untuk pagination dua arah. Mantan anggota tidak punya akses baca maupun tulis. Gambar maksimal 5 MB dengan tipe divalidasi dari byte awal (keputusan 12). Tidak ada edit atau hapus pesan di tahap awal. Kartu sistem hanya merujuk id, sedangkan datanya dibaca dari tabel sumbernya sehingga kartu selalu mutakhir. Tabel pendukung GroupChat dan ChatReadState serta aturan lengkapnya ada di K38 sampai K41.

**Reminder**

id, groupId, debtorId, creditorId, sentAt, emailOutboxId. Aturan jeda 12 jam dan maksimal 3 kali per pasangan diperiksa dari tabel ini, dan penulisannya satu transaksi dengan pengecekan agar klik ganda tidak lolos.

**IdempotencyKey**

id, userId, key, method, path, statusCode, responseBody, createdAt. Unik (userId, key). Dipakai oleh endpoint penulis ledger, klaim item, dan pelunasan, sebagai pelindung ganda di atas kolom LedgerEntry.idempotencyKey.

**Penyimpanan berkas (Blob)**

Tiga container privat: receipts (struk), proofs (bukti transfer), chat (gambar chat). Berkas tidak diakses langsung oleh klien. Backend memeriksa keanggotaan lalu mengalirkan berkas atau menerbitkan URL bertanda tangan berumur pendek.

<!-- akhir-bagian-6b -->

## 7. State machine dan aturan keputusan

### 7.1 Koreksi atas bagian 6

- Aturan ALL_PARTICIPANTS dihapus dari tabel rule di 6.4. Persetujuan peserta subset ditangani oleh TransactionShare.consent. Satu penolakan tidak membatalkan transaksi: share milik penolak menjadi REJECTED, dan penalang mengubah daftar peserta (membuat revisi) atau membiarkannya kedaluwarsa.
- Transaction mendapat kolom expiresAt (diisi saat status PENDING_APPROVAL, tujuh hari sejak pengajuan). Berlaku untuk transaksi yang memakai Approval maupun yang menunggu consent peserta.
- K11: pada struk gagal AI dengan mode EQUAL_SUBSET, validitas struk diputuskan lewat Approval admin, dan tanggungan tiap peserta tetap membutuhkan consent peserta itu (TransactionShare). Transaksi baru ACTIVE bila keduanya terpenuhi.

### 7.2 Pemilihan jalur saat transaksi diajukan

Service memilih jalur berdasarkan struk, hasil AI, mode, dan peran pengaju. Tabel dibaca dari atas ke bawah, kasus pertama yang cocok berlaku.

| No | Kasus | Hasil |
|---|---|---|
| 1 | Tidak ada pemilih, dievaluasi setelah kasus 2 lolos (grup satu anggota, atau pengaju satu-satunya anggota aktif) | ACTIVE langsung, satu baris AuditLog (keputusan 2). |
| 2 | Mode ITEMIZED tanpa struk | Ditolak validasi (K9). |
| 3 | Struk VERIFIED, mode EQUAL_ALL | ACTIVE langsung. Share dibuat berstatus ACCEPTED dan CHARGE ditulis. |
| 4 | Struk VERIFIED, mode EQUAL_SUBSET | PENDING_APPROVAL tanpa Approval. Share berstatus PENDING. ACTIVE bila semua share ACCEPTED. |
| 5 | Struk VERIFIED, mode ITEMIZED | ACTIVE. Kartu pilih item terbit, fase klaim dimulai. |
| 6 | Struk FAILED atau NEEDS_REVIEW, pengaju MEMBER | Approval ADMIN_ANY. |
| 7 | Struk FAILED atau NEEDS_REVIEW, pengaju admin, ada admin lain aktif | Approval ADMIN_OTHER. |
| 8 | Struk FAILED atau NEEDS_REVIEW, pengaju adalah satu-satunya admin | Approval QUORUM_20. |
| 9 | Tanpa struk, mode EQUAL_ALL | Approval MAJORITY. |
| 10 | Tanpa struk, mode EQUAL_SUBSET | PENDING_APPROVAL tanpa Approval. Semua peserta harus ACCEPTED. |

Kasus 6 sampai 8 yang bermode EQUAL_SUBSET juga memerlukan consent peserta (K11). Kasus 6 sampai 8 yang bermode ITEMIZED baru menerbitkan kartu setelah Approval APPROVED (K9).

Catatan istilah: OWNER termasuk admin. Pada kasus 7 dan 8, "ada admin lain" berarti ada admin atau OWNER aktif selain pengaju.

### 7.3 State machine

**Transaction.status**

| Dari | Ke | Pemicu dan syarat |
|---|---|---|
| (baru) | ACTIVE | Kasus 1, 3, 5 di tabel 7.2. |
| (baru) | PENDING_APPROVAL | Kasus 4, 6 sampai 10. |
| PENDING_APPROVAL | ACTIVE | Approval APPROVED dan, bila mode EQUAL_SUBSET, semua share ACCEPTED. CHARGE ditulis pada saat ini. |
| PENDING_APPROVAL | REJECTED | Approval REJECTED. Transaksi tetap tersimpan dan tampil di riwayat dengan status ditolak. |
| PENDING_APPROVAL | EXPIRED | expiresAt lewat tanpa keputusan. Dapat diajukan ulang sebagai transaksi baru yang merujuk yang lama. Evaluasi lazy saat dibaca atau diberi suara, dengan job terjadwal sebagai cadangan. |
| ACTIVE | ACTIVE | Revisi diterapkan (APPLIED), kolom version bertambah satu. |
| ACTIVE | TAKEN_DOWN | Takedown oleh admin dengan alasan wajib. Semua CHARGE terkait dibalik lewat REVERSAL, klaim item menjadi VOIDED (G5), AuditLog ditulis. |

REJECTED, EXPIRED, dan TAKEN_DOWN adalah status akhir. Transaksi tidak pernah dihapus.

**Dampak takedown setelah ada pelunasan terkonfirmasi.** REVERSAL membuat saldo pasangan menjadi negatif sebesar kelebihan bayar. Menurut 6.2, itu otomatis terbaca sebagai kredit ke pembayarnya, sehingga penerima berutang mengembalikan. Tidak ada tipe entri khusus.

**Approval.status**

| Dari | Ke | Pemicu |
|---|---|---|
| OPEN | APPROVED | Penentu tunggal: suara setuju pertama. Kuorum biasa: jumlah setuju mencapai required. |
| OPEN | REJECTED | Penentu tunggal: suara tolak pertama. Kuorum biasa: jumlah tolak melebihi eligibleCount dikurangi required. |
| OPEN | EXPIRED | expiresAt lewat. |

Status akhir tidak berubah lagi. Pengaju tidak boleh memberi suara pada Approval miliknya.

**TransactionRevision.status**

| Dari | Ke | Pemicu |
|---|---|---|
| (baru) | APPLIED | Revisi admin yang tidak menyentuh tanggungan admin itu sendiri, dan baseVersion masih sama dengan Transaction.version. |
| (baru) | PENDING_APPROVAL | Revisi yang membutuhkan Approval (6.4). |
| PENDING_APPROVAL | APPLIED | Approval APPROVED dan baseVersion masih sama. |
| PENDING_APPROVAL | REJECTED atau EXPIRED | Approval REJECTED atau EXPIRED, atau baseVersion sudah berubah (revisi gugur dan harus diajukan ulang). |

**ItemClaim.status**

| Dari | Ke | Pemicu |
|---|---|---|
| (baru) | HOLDING | Klaim atomik berhasil (UPDATE bersyarat di 6.3). holdExpiresAt diisi 12 jam ke depan. |
| HOLDING | DONE | Anggota menekan Done. CHARGE per unit ditulis. |
| HOLDING | RELEASED | Dibatalkan pemilik, atau hold lewat 12 jam (dilepas saat ada klaim lain pada item itu, atau oleh job cadangan). claimedQty dikurangi atomik. |
| DONE | DONE | Diubah pemilik: REVERSAL ditambah CHARGE baru (K5), selama belum terkunci (K2). |
| DONE | RELEASED | Dibatalkan pemilik, selama belum terkunci. REVERSAL ditulis. |
| HOLDING atau DONE | VOIDED | Takedown transaksi (G5). |

Pengingat HOLD_EXPIRING dikirim pada jam ke-10 dengan satu Notification per klaim.

Fase FINALIZE pada mode ITEMIZED (K4): setelah seluruh unit terklaim, atau penalang mengambil unit sisa (keputusan 6), ongkir ditulis sebagai CHARGE merata ke anggota yang punya minimal satu klaim DONE (G1). Sebelum FINALIZE, tidak ada CHARGE ongkir.

**ItemAssignment.status**

| Dari | Ke | Pemicu |
|---|---|---|
| (baru) | OFFERED | Penalang menunjuk anggota atas item yang masih tersisa, kapan saja (K17). |
| OFFERED | ACCEPTED | Penunjukan pertama yang diterima, lewat UPDATE bersyarat atomik pada item. Item menjadi milik penerima dengan klaim DONE. |
| OFFERED | DECLINED | Ditolak oleh yang ditunjuk. |
| OFFERED | CANCELLED | Penunjukan lain atas item yang sama sudah ACCEPTED. |

Bila semua penunjukan DECLINED, penalang boleh mengambil item itu sendiri.

**PaymentConfirmation.status**

| Dari | Ke | Pemicu |
|---|---|---|
| (baru) | PENDING | Pengutang mengirim formulir pelunasan (nominal, metode, bukti kecuali CASH). Nominal tidak boleh melebihi utang bersih pasangan itu saat pengajuan. |
| PENDING | CONFIRMED | Kreditur menyetujui. Satu entri SETTLEMENT ditulis. |
| PENDING | REJECTED | Kreditur menolak. |
| PENDING | CANCELLED | Pengirim membatalkan selama belum dikonfirmasi. |

**GroupMember.status**

| Dari | Ke | Pemicu |
|---|---|---|
| (baru) | ACTIVE | Gabung lewat kode tanpa persetujuan, permintaan gabung disetujui admin, atau undangan diterima (K28, K29). |
| ACTIVE | LEFT | Keluar sendiri. Hanya jika saldo nol, kecuali admin override dengan alasan tercatat. |
| ACTIVE | REMOVED | Dikeluarkan admin. Syarat saldo sama dengan LEFT. OWNER tidak dapat dikeluarkan. |
| LEFT atau REMOVED | ACTIVE | Bergabung kembali. LEFT lewat kode. REMOVED hanya lewat permintaan yang disetujui admin atau undangan yang diterima, setelah jeda 24 jam (K30). Baris yang sama dipakai. |

OWNER tidak dapat LEFT sebelum menyerahkan kepemilikan. Pemegang dana tidak dapat LEFT sebelum menyerahkan dana (K10). Mantan anggota yang masih punya utang atau piutang tetap tampil di ledger sebagai mantan anggota (keputusan 7).

<!-- akhir-bagian-7a -->

### 7.4 Matriks hak akses

Otorisasi ditegakkan di service, bukan di klien (prinsip 5). Setiap rute memeriksa keanggotaan ACTIVE lebih dulu, lalu aksi di bawah ini. Penalang adalah payerId transaksi. Pemegang dana adalah GroupFund.holderId. Keduanya atribut, bukan peran.

| Aksi | OWNER | ADMIN | MEMBER | Catatan |
|---|---|---|---|---|
| Melihat grup, anggota, riwayat transaksi | ya | ya | ya | Hanya anggota ACTIVE. Non-anggota mendapat 403. |
| Melihat kode grup | ya | ya | bila tidak disembunyikan | Bergantung Group.codeHidden. |
| Mengubah pengaturan grup (kode tersembunyi, persetujuan gabung, metode pembayaran grup) | ya | ya | tidak | |
| Menyetujui atau menolak permintaan gabung, mengundang via email terdaftar | ya | ya | tidak | |
| Mengeluarkan anggota | ya | hanya MEMBER | tidak | Syarat saldo nol atau override. K12. |
| Mengangkat atau menurunkan admin, memindahkan kepemilikan | ya | tidak | tidak | Keputusan 1. |
| Keluar sendiri | setelah serah terima | ya | ya | Syarat saldo nol atau override. |
| Override keluar atau dikeluarkan dengan saldo tidak nol | ya | ya | tidak | Alasan wajib, AuditLog OVERRIDE_LEAVE. OWNER tidak dapat dikeluarkan. |
| Membuat transaksi | ya | ya | ya | payerId diambil dari token, tidak bisa atas nama orang lain. |
| Upload struk dan verifikasi AI | penalang | penalang | penalang | Hanya penalang transaksi itu. |
| Memberi suara pada Approval | sesuai rule | sesuai rule | sesuai rule | ADMIN_ANY dan ADMIN_OTHER hanya admin. MAJORITY dan QUORUM_20 semua anggota aktif. Pengaju tidak boleh memilih miliknya. |
| Consent atas share sendiri | ya | ya | ya | Hanya pemilik share. |
| Revisi hasil AI dan nominal | langsung | langsung | tidak | Admin langsung berlaku, kecuali menyentuh tanggungannya sendiri (K6). Penalang non-admin hanya setelah distribusi dan lewat Approval. |
| Takedown | ya | ya | tidak | Alasan wajib. Takedown yang mengurangi tanggungan pelakunya sendiri butuh admin lain (K6). |
| Klaim item dan Done | ya | ya | ya | Anggota ACTIVE pada transaksi ITEMIZED. |
| Menunjuk anggota untuk item belum terpilih | penalang | penalang | penalang | Setelah 24 jam. |
| Mengirim pelunasan | debitur | debitur | debitur | Hanya pihak yang berutang. |
| Mengonfirmasi atau menolak pelunasan | kreditur | kreditur | kreditur | Hanya penerima pelunasan. |
| Membatalkan pelunasan | pengirim | pengirim | pengirim | Selama masih PENDING. |
| Mengirim pengingat email | kreditur | kreditur | kreditur | Batas 12 jam dan 3 kali per utang. |
| Membuat dana dan menunjuk pemegang | ya | ya | tidak | |
| Menambah dana, menandai transaksi dibayar dana | pemegang | pemegang | pemegang | Tidak ada pengecualian untuk admin. |
| Melihat nama pemegang dana | ya | ya | hanya bila pemegang | Anggota lain melihat Dana Kelompok. Lihat 8.1. |
| Mengirim dan membaca chat | ya | ya | ya | Anggota ACTIVE saja. |
| Memakai chatbot | ya | ya | ya | Hanya data grup tempat penanya ACTIVE. |
| Melihat nomor rekening | pihak bertransaksi | pihak bertransaksi | pihak bertransaksi | Hanya yang berutang kepada atau dipiutangi pemilik, termasuk mantan anggota. |
| Membaca AuditLog transaksi | ya | ya | ya | Anggota ACTIVE. Pelaku entri dana disamarkan (8.1). |

Mantan anggota (LEFT atau REMOVED) hanya mengakses bagian ledger miliknya: saldo, rincian, dan pelunasan, serta metode pembayaran pihak lawan. Tanpa chat dan tanpa riwayat lain (keputusan 7).

### 7.5 Koreksi atas bagian 6 dan 7

1. Urutan tabel 7.2: kasus 2 (ITEMIZED tanpa struk ditolak) dievaluasi sebelum kasus 1 (tidak ada pemilih). Tanpa ini, grup satu anggota dapat membuat transaksi per item tanpa struk.
2. Batas pelunasan: jumlah semua PaymentConfirmation berstatus PENDING ditambah yang baru tidak boleh melebihi saldo searah debitur ke kreditur. Pemeriksaan dilakukan di dalam transaksi database dengan kunci pada pasangan, dan diulang saat konfirmasi.
3. Pengaju sama dengan penalang. payerId diisi dari token pengguna dan tidak dapat diisi dari body permintaan.
4. Pelaku entri dana: kolom createdBy pada LedgerEntry dan FundEntry, serta actorId pada AuditLog untuk aksi FUND_MARK, tidak diekspos kepada anggota selain admin dan pemegang. Tampil sebagai Dana Kelompok.
5. K12: admin biasa hanya dapat mengeluarkan MEMBER. Admin yang akan dikeluarkan harus diturunkan dulu oleh OWNER. Ini konsekuensi keputusan 1 (hanya OWNER yang mengelola admin).

<!-- akhir-bagian-7b -->

## 8. Pengecualian dan risiko yang diterima

### 8.1 Kebocoran identitas pemegang dana (keputusan 9)

Semua anggota melihat dana sebagai Dana Kelompok. Namun pelunasan dari dana ke penalang dilakukan oleh pemegang (PaymentConfirmation.senderId adalah pemegang), sehingga penalang melihat nama dan metode pembayaran pemegang saat pembayaran terjadi. Ini pengecualian yang diterima.

Batasan yang tetap berlaku:

- Hanya pihak yang bertransaksi dengan dana pada pelunasan itu (penalang yang dibayar, atau pihak yang berutang kepada dana) yang melihat nama pemegang. Anggota lain tidak.
- Pengaturan dana menampilkan nama pemegang hanya kepada admin dan pemegang.
- Pelaku entri dana disamarkan di ledger, FundEntry, dan AuditLog (7.5 butir 4).

### 8.2 Risiko yang diterima

| Risiko | Ketentuan |
|---|---|
| Mayoritas dapat membebani anggota yang menolak pada biaya tanpa struk (MAJORITY). | Dikendalikan lewat pop-up, audit, takedown admin, dan batas nominal Rp100.000.000. Batas khusus tanpa struk adalah keputusan produk yang ditunda. |
| Admin tunggal dengan QUORUM_20 pada grup kecil lolos dengan sedikit suara (n = 5 butuh 1 suara). | Aturan ditetapkan produk. |
| Gemini penentu tunggal verifikasi struk sampai model tahap 1 dari AI Engineer siap. Akurasi belum diukur resmi. | Angka akurasi menunggu set uji berlabel dari dataset. |
| JWT 1 jam tanpa refresh token sampai Tahap 2. | Pemilihan item real-time bisa terputus saat token habis. |
| Socket.IO satu instance. | Skala horizontal butuh adapter tambahan dan di luar cakupan. |
| Koneksi database lokal memakai encrypt false. | Wajib encrypt true dan trustServerCertificate false saat pindah ke Azure SQL. |
| Kunci enkripsi nomor rekening berasal dari env sampai Key Vault tersedia. | Pencarian berdasarkan nomor tidak didukung. |
| Deteksi struk ganda berbasis isi hanya peringatan (K8). | Foto ulang dengan hasil baca berbeda dapat lolos. |
| Kedaluwarsa dievaluasi lazy. | Tampilan bisa tertinggal sampai data dibaca. Job cadangan membatasi keterlambatan. |
| Rekomendasi pelunasan lintas pihak tidak tersedia (K3). | Hanya netting dua arah. |

## 9. Deviasi dari rencana awal dan status Tahap 0

### 9.1 Deviasi untuk laporan

| Rencana awal | Kondisi sekarang | Alasan |
|---|---|---|
| Login email dan No. HP | Email dan password saja | No. HP dibatalkan. |
| Verifikasi struk dua tahap (model pemfilter lalu OCR) | Gemini merangkap kedua tahap sementara | Kontrak dengan AI Engineer belum disepakati. |
| Real-time dibatalkan | Socket.IO dipakai untuk pemilihan item dan chat | Fitur pembeda produk. |
| Cakupan fitur lebih kecil | Sekitar 20 modul dalam 6 tahap, tiap tahap punya definisi selesai sendiri | Cakupan diperluas. |
| Saldo dari TransactionSplit yang bisa berubah | Ledger append-only (LedgerEntry) | Riwayat tidak boleh diubah (prinsip 1). |
| computeBalances menghitung semua transaksi tanpa melihat status struk | Saldo hanya dari entri ledger, dan CHARGE ditulis setelah transaksi lolos | Koreksi atas isu #15 dan #18. |
| Rekomendasi pelunasan greedy multilateral | Pelunasan bilateral saja (K3) | Pelunasan harus punya pasangan yang sah. |
| Stiker di chat | Dibatalkan | Masalah hak cipta. |
| Pembayaran lewat aplikasi (payment gateway) | Tidak dibuat | Di luar cakupan, pekerjaan lanjutan. |
| Dana kelompok sebagai pengutang biasa | Pseudo-akun di ledger (K1) | Mencegah pencampuran saldo pribadi dan dana. |

### 9.2 Status Tahap 0

Sudah ada: keputusan produk final, ERD v2, state machine, aturan persetujuan, matriks hak akses, daftar koreksi K1 sampai K12.

Belum ada, sehingga Tahap 0 belum boleh dinyatakan selesai:

- docs/api-contract.md.
- Review ERD dan kontrak oleh Aqidatul (kebutuhan frontend) dan Bintang (kontrak AI).
- Issue GitHub per tahap.
- Migration (sengaja belum ditulis sebelum review selesai).

<!-- akhir-bagian-9 -->

## 10. Koreksi lanjutan dari penyusunan kontrak API

Bagian ini mencatat koreksi yang ditemukan saat menulis docs/api-contract.md. Lanjutan dari bagian 5 (K1 sampai K10) dan 7.5 (K11 dan K12).

### K13. Preferensi email notifikasi

Masalah: spesifikasi menyebut email notifikasi admin bersifat opsional, tetapi ERD belum menyimpan pilihannya.

Perbaikan: kolom User.notifyByEmail (default false), tercatat di 6.1.

### K14. Pembulatan pada mode ITEMIZED

Masalah: K4 menetapkan CHARGE per unit dihitung sekali dan tetap, sedangkan klaim bisa sebagian dari qty item. Biaya satu item (setelah porsi PPN, service, dan diskon) tidak selalu habis dibagi qty. Menetapkan sisa rupiah ke pengklaim tertentu akan bergeser setiap klaim berubah. Karena itu batas selisih maksimal Rp1 per orang tidak dapat dipenuhi pada mode ini tanpa menulis ulang CHARGE terus-menerus.

Perbaikan:
- Biaya item (C_i) dihitung sekali per versi ekstraksi dengan largest remainder antar item, tie-break id item menaik. Jumlah semua C_i sama dengan total dikurangi ongkir.
- Biaya per unit adalah floor(C_i / qty_i).
- Sisa rupiah item (C_i dikurangi floor dikali qty, bernilai 0 sampai qty dikurangi 1) ditanggung penalang sebagai bagian biayanya sendiri, bukan utang siapa pun.

Akibat: jumlah semua bagian, termasuk bagian penalang, tetap persis sama dengan total struk. Batas Rp1 per orang tetap berlaku untuk mode MERATA. Pada ITEMIZED penalang dapat menanggung hingga qty dikurangi 1 rupiah per item. Ongkir dibagi saat FINALIZE dengan largest remainder, tie-break userId menaik.

### K15. Kolom yang kurang pada ERD

- ReceiptExtraction.shipping (ongkir) belum ada, padahal ongkir dibebankan merata pada mode ITEMIZED. Aritmetika struk menjadi: item ditambah service, ditambah pajak (bila eksklusif), ditambah ongkir, dikurangi diskon, sama dengan total.
- ItemAssignment memerlukan qty dan offerGroupId agar penunjukan beberapa kandidat atas satu item dapat dibatalkan bersama ketika yang pertama menerima (keputusan 6).

### K16. Done, finalisasi, dan privasi event

- Done dilakukan per pengguna per transaksi, bukan per item: semua baris HOLDING milik pengguna itu menjadi DONE sekaligus.
- Finalisasi terjadi otomatis saat semua unit berstatus DONE. Penalang juga dapat memfinalisasi kapan saja (diubah oleh K18).
- Event share:updated tidak disiarkan ke seluruh grup karena mengungkap siapa yang menolak. Event hanya dikirim ke penalang dan peserta bersangkutan. Apakah daftar consent terlihat oleh semua anggota diputuskan di bagian transaksi pada kontrak API.

<!-- akhir-bagian-10 -->

### K17. Penunjukan item oleh penalang dan batas kewenangan

Masalah: K16 menetapkan unit yang tidak diklaim sebagai bagian penalang dan membatasi penunjukan setelah 24 jam. Kenyataannya, sisa itu bisa saja milik orang tertentu.

Perbaikan:
- Penalang dapat menunjuk anggota atas unit yang masih tersisa kapan saja. Angka 24 jam hanya menjadi penanda pengiriman notifikasi ITEM_UNCLAIMED. Ini memperluas keputusan 6.
- Yang ditunjuk harus meng-ACC. Tanpa persetujuan, tidak ada utang yang tercipta (keputusan 4 dan 6 tetap berlaku).
- Penunjukan tidak mencadangkan unit. Anggota yang lebih dulu berhasil memegang unit itu menang secara atomik, dan penunjukan menjadi gagal dengan item-unavailable.
- Admin tidak dapat membebankan item kepada anggota tanpa persetujuan orang itu. Akibatnya, jika yang ditunjuk menolak, beban tetap pada penalang. Ini risiko yang diterima: penalang yang dirugikan menyelesaikannya secara sosial, dengan riwayat sebagai bukti.
- Kewenangan admin terhadap penalang yang curang: membatalkan penunjukan yang masih OFFERED (alasan wajib), takedown, revisi (langsung berlaku kecuali menyentuh tanggungannya sendiri, K6), dan membaca riwayat. Semuanya tercatat.

### K18. Penalang menutup pembagian kapan saja

Perbaikan atas K16:
- Penalang dapat memfinalisasi kapan saja selama fase CLAIMING. Pada saat itu: baris HOLDING milik anggota dilepas (RELEASED, pemilik diberi notifikasi ITEMS_CLOSED), penunjukan OFFERED menjadi CANCELLED, unit yang belum diklaim tidak menghasilkan utang siapa pun, dan ongkir ditulis (K4, G1).
- Tidak ada endpoint membuka kembali. Membuka kembali berarti menulis ulang ongkir, dan jika satu orang melepas pilihannya, porsi ongkir orang lain naik tanpa persetujuan mereka (melanggar keputusan 4).
- Koreksi setelah FINALIZED dilakukan lewat revisi: perubahan klaim ditulis REVERSAL ditambah CHARGE baru, orang yang tanggungannya naik wajib setuju ulang, dan klaim yang terkunci (K2) tidak dapat diubah.
- Kolom baru pada Transaction: itemsPhase (CLAIMING atau FINALIZED), finalizedAt, finalizedBy (kosong berarti sistem).
- Penalang yang menutup terlalu cepat menanggung sisa unit sendiri, sehingga anggota lain tidak dirugikan.

### K19. Riwayat menyeluruh

Masalah: ItemClaim, ItemAssignment, dan ApprovalVote adalah tabel kerja yang berubah. Pilihan HOLDING yang dibatalkan tidak menyentuh ledger, sehingga jejaknya hilang. AuditLog sebelumnya hanya mencatat sebagian aksi.

Perbaikan:
- Setiap aksi tulis oleh pengguna atau sistem menulis satu baris AuditLog dalam transaksi database yang sama dengan aksinya. Jika penulisan gagal, aksinya juga gagal.
- actorId kosong berarti sistem (pelepasan hold otomatis, kedaluwarsa, finalisasi otomatis).
- Alasan wajib hanya untuk aksi yang mengubah nilai atau membatalkan milik orang lain (REVISE, TAKEDOWN, OVERRIDE_LEAVE, pembatalan penunjukan oleh admin). Aksi rutin tidak memerlukan alasan.
- Pelaku entri dana disamarkan (7.5 butir 4). Riwayat dapat dibaca semua anggota ACTIVE. Mantan anggota hanya melihat baris yang terkait ledger miliknya.
- Penegakan: satu fungsi bersama untuk menulis AuditLog dipanggil oleh service, dan tes integrasi memeriksa bahwa tiap endpoint tulis menghasilkan baris riwayat.

Batas jaminan: trigger database mencegah perubahan dan penghapusan lewat aplikasi. Pengelola database yang memiliki akses langsung masih dapat mengubah data. Rantai hash tidak dibuat. Laporan tidak boleh mengklaim riwayat kebal terhadap pengelola server.

<!-- akhir-bagian-10b -->

### K20. Tahap DRAFT, penarikan pengajuan, dan pemilihan jalur saat submit

Masalah: tabel 7.2 memilih jalur persetujuan saat transaksi diajukan berdasarkan hasil verifikasi struk, tetapi struk baru diunggah dan diverifikasi sesudah transaksi dibuat. Alurnya tidak dapat dijalankan. Pengaju yang salah kirim juga tidak punya cara menarik pengajuan selain menunggu kedaluwarsa tujuh hari.

Perbaikan:
- Transaction.status mendapat DRAFT dan WITHDRAWN. Approval.status mendapat CANCELLED.
- Transaksi dibuat sebagai DRAFT. Hanya penalang yang melihatnya. Tidak ada ledger, notifikasi, atau suara. Struk diunggah dan diverifikasi saat DRAFT.
- Endpoint submit menjalankan tabel 7.2 dan memindahkan transaksi dari DRAFT ke status tujuannya. Pilihan jalur terjadi pada saat submit, bukan saat pembuatan.
- DRAFT bukan bagian riwayat. Aksi pada DRAFT dikecualikan dari K19, dan DRAFT yang dihapus tidak meninggalkan jejak. Pencatatan AuditLog dimulai saat submit.
- WITHDRAWN: penalang dapat menarik pengajuannya selama PENDING_APPROVAL. Approval yang terbuka menjadi CANCELLED, consent yang tertunda gugur, dan status WITHDRAWN tampil di riwayat seperti REJECTED. Transaksi ACTIVE tidak dapat ditarik. Koreksinya lewat revisi atau takedown.
- Struk tidak dapat ditambahkan sesudah submit. Penalang membuat transaksi baru bila perlu.
- Kecocokan isi struk (K8) mengubah jalur: struk VERIFIED yang berstatus possible-duplicate diperlakukan seperti NEEDS_REVIEW, jadi masuk Approval admin.

### K21. Mode CUSTOM dipertahankan

Masalah: kode yang sudah berjalan mendukung pembagian CUSTOM (nominal per orang, jumlah harus sama dengan total), tetapi spesifikasi final hanya menyebut tiga mode.

Perbaikan: CUSTOM menjadi mode keempat. Aturan persetujuannya identik dengan EQUAL_SUBSET: setiap peserta yang bukan penalang harus consent atas nominalnya, dan struk gagal AI tetap divalidasi admin (K11). Semua aturan di 7.1 sampai 7.3 yang menyebut EQUAL_SUBSET berlaku juga untuk CUSTOM.

### K22. Kenaikan tanggungan yang tidak disetujui

Masalah: revisi dapat menaikkan total. Peserta yang tanggungannya naik harus setuju ulang (keputusan 4). Jika ia menolak, jumlah semua bagian menjadi lebih kecil dari total transaksi.

Perbaikan:
- Selama consent tertunda, CHARGE tambahan belum ditulis. Penurunan tanggungan langsung berlaku (REVERSAL sebesar selisih).
- Bagian kenaikan yang ditolak, atau consent-nya kedaluwarsa tujuh hari, ditanggung penalang dan tidak menjadi utang siapa pun, sama seperti unit yang tidak diklaim (K18). Penalang dapat mengajukan revisi baru.
- Jumlah seluruh bagian, termasuk bagian yang ditanggung penalang, tetap sama dengan total.

Contoh: total Rp70.000 dibagi tiga (Rp23.334, Rp23.333, Rp23.333) naik menjadi Rp76.000 (Rp25.334, Rp25.333, Rp25.333). Kenaikannya Rp2.000 per orang. Jika satu peserta menolak, Rp2.000 ditanggung penalang.

Risiko yang diterima: revisi yang dilakukan admin dapat membuat penalang menanggung bagian yang tidak disetujui peserta. Pembatasnya adalah riwayat (K19) dan kewenangan admin yang tercatat.

### K23. Siapa melihat daftar consent

Masalah: membuka status consent kepada seluruh anggota mengumumkan siapa yang menolak. Spesifikasi hanya menyatakan peserta yang menolak tidak dibebani, bukan diumumkan.

Perbaikan:
- Selama transaksi belum ACTIVE, daftar peserta beserta status consent hanya terlihat oleh penalang, admin, dan masing-masing peserta untuk bagiannya sendiri. Anggota lain hanya melihat jumlah peserta.
- Setelah ACTIVE, seluruh anggota melihat daftar peserta dan nominalnya. Pada saat itu semua consent sudah ACCEPTED dan tidak ada informasi penolakan yang terbuka.
- Peserta yang menolak dikeluarkan dari daftar peserta saat penalang merevisi. Penolakannya hanya tercatat di riwayat dengan akses yang sama.

### K24. Zona waktu pengelompokan bulan

Riwayat bulanan dikelompokkan menurut Asia/Jakarta (UTC+7), bukan UTC. Waktu tetap disimpan UTC. Contoh: transaksi pada 1 November 00:30 WIB tersimpan sebagai 31 Oktober 17:30 UTC dan tetap masuk November. Pengelompokan memakai Transaction.createdAt, bukan tanggal pembelian di struk (ReceiptExtraction.purchasedAt), supaya satu transaksi tidak berpindah bulan ketika hasil baca struk direvisi. Zona waktu disimpan sebagai konstanta.

<!-- akhir-bagian-10c -->

### K25. Saldo per pasangan tak berurut (menggantikan 6.2 dan mengubah K3)

Masalah: bagian 6.2 mendefinisikan saldo pasangan secara searah dan menyebut hasil negatif sebagai kredit ke arah sebaliknya. Pelunasan ke arah sebaliknya itu mengurangi saldo arah yang berbeda, sehingga angka tidak kembali ke nol. Contoh: A berutang ke B Rp50.000 dan sudah melunasi, lalu transaksinya diturunkan. Saldo A ke B menjadi minus Rp50.000. Saat B membayar kembali ke A, pelunasan itu tercatat sebagai pengurangan saldo B ke A, sedangkan saldo A ke B tetap minus Rp50.000. Kredit dari takedown atau revisi yang menurunkan nominal pasti terjadi, sehingga pendekatan searah tidak dapat dipertahankan.

Perbaikan:
- d(X ke Y) adalah jumlah sign dikali amount atas LedgerEntry dengan debitur X dan kreditur Y.
- Saldo pasangan N(A, B) adalah d(A ke B) dikurangi d(B ke A). Positif berarti A berutang kepada B. Nol berarti lunas.
- Pelunasan dari A ke B hanya sah bila N(A, B) lebih besar dari nol dan nominalnya tidak melebihi N dikurangi total pelunasan A ke B yang masih PENDING. Pemeriksaan dilakukan dalam transaksi database dengan kunci pada pasangan, dan diulang saat konfirmasi.
- Netting dua arah menjadi bawaan. Tombol sederhanakan dan kolom Group.settleSimplify dihapus. Rekomendasi multilateral tetap tidak ada (K3).
- Rincian asli per kreditur tetap ditampilkan: untuk tiap pihak, pecahan biaya grup, biaya individu, dan pelunasan, serta daftar baris ledger. Yang berubah hanya angka utamanya: angka bersih.
- Total saldo bersih seluruh pihak dalam satu grup harus nol. Pemeriksaan keseimbangan di 5.4 dipertahankan.

Contoh: A menanggung Rp50.000 kepada B, B menanggung Rp20.000 kepada A. N(A, B) adalah Rp30.000. Setelah A melunasi Rp30.000, N menjadi nol.

Dampak: kunci pilihan item (K2) memakai waktu konfirmasi pelunasan terakhir pada pasangan pengutang dan penalang. Dana kelompok adalah pihak ledger yang berperan sebagai debitur atau kreditur dalam pasangan, dengan aturan yang sama.

### K26. Metode pembayaran: kapan wajib dan metode yang diterima grup

Masalah: spesifikasi menyatakan profil wajib berisi minimal satu metode, tetapi tidak menyebut kapan ditegakkan. Menegakkannya saat registrasi menghambat orang yang hanya berutang. Pembatasan jenis metode oleh grup juga dapat menyisakan penerima tanpa metode yang diterima.

Perbaikan:
- Minimal satu metode aktif ditegakkan pada dua titik: saat penalang mengirim transaksi (submit), dan saat menonaktifkan metode terakhir. Pelanggaran memberi 409 payment-method-required dan 409 last-payment-method.
- Penolakan tunai berarti tidak memiliki metode CASH. Pengguna yang menolak tunai wajib memiliki bank atau dompet digital.
- Pelunasan hanya boleh dengan jenis metode yang diizinkan grup (GroupPaymentSetting.allowedKinds kosong berarti semua) dan yang dimiliki penerima. Bila tidak ada irisan: 409 no-accepted-method.
- Nomor rekening hanya dibuka kepada pengutang yang memiliki saldo positif ke penerima. Bagian 8.1 berlaku untuk pelunasan atas nama dana.

### K27. Pengingat: siklus utang dan email

- Siklus utang adalah masa sejak N pasangan terakhir bernilai nol atau berbalik arah. Maksimal tiga pengingat per siklus, dengan jeda 12 jam (konstanta di bagian 4). Siklus dihitung dari ledger saat permintaan, tanpa kolom khusus. Rincian implementasi ditentukan di Tahap 1.
- Pengingat adalah aksi eksplisit kreditur sehingga email tetap dikirim tanpa memperhatikan User.notifyByEmail. Notifikasi dalam aplikasi (REMINDER) juga dibuat.
- Isi email memuat nama kreditur, nama grup, dan nominal. Tidak memuat email kreditur maupun nomor rekening.
- Pengingat hanya dapat dikirim kepada debitur dengan N positif kepada pengirim, termasuk mantan anggota yang masih berutang.

<!-- akhir-bagian-10d -->

### K28. Permintaan gabung dan undangan di tabel terpisah (mengganti status PENDING)

Masalah: GroupMember.status PENDING menimpa status LEFT atau REMOVED anggota lama yang mengajukan gabung. Jika permintaan kedaluwarsa atau dibatalkan, status sebelumnya hilang. Permintaan juga dapat menumpuk tanpa batas waktu.

Perbaikan:
- GroupMember hanya memiliki status ACTIVE, LEFT, dan REMOVED. Hanya anggota ACTIVE yang menjadi pemilih, peserta, dan penerima siaran grup.
- GroupJoinRequest: id, groupId, userId, status (PENDING, APPROVED, REJECTED, CANCELLED, EXPIRED), createdAt, decidedAt, decidedBy. Filtered unique (groupId, userId) bila status PENDING.
- GroupInvitation: id, groupId, inviteeEmail (huruf kecil, dinormalisasi), invitedBy, status (PENDING, ACCEPTED, DECLINED, CANCELLED, EXPIRED), createdAt, decidedAt, acceptedBy. Filtered unique (groupId, inviteeEmail) bila status PENDING.
- Keduanya tabel kerja. Setiap aksinya tetap ditulis ke AuditLog (K19). Kedaluwarsa tujuh hari dievaluasi saat dibaca, dengan job terjadwal sebagai cadangan.
- Menyetujui permintaan atau menerima undangan menghidupkan kembali baris GroupMember yang sama (status ACTIVE) atau membuat baris baru.

### K29. Undangan email harus diterima, dan tidak membuka status registrasi (mengubah keputusan 8)

Masalah:
- Menambah anggota langsung memasukkan orang ke grup tanpa persetujuannya. Ia langsung menjadi pemilih dan dapat dibebani oleh aturan MAJORITY pada biaya tanpa struk.
- Endpoint tambah lewat email memberi tahu admin apakah sebuah email terdaftar. Pembuat grup otomatis OWNER, jadi siapa pun yang mendaftar dapat membuat grup lalu menguji alamat email apa pun.

Perbaikan:
- Admin mengundang, dan penerima harus menerima. Yang berubah dari keputusan 8: kata menambah menjadi mengundang.
- Respons pembuatan undangan selalu sama (202), tanpa membedakan email terdaftar, sudah menjadi anggota, atau sudah diundang.
- Daftar undangan untuk admin hanya memuat email yang disamarkan dan status, bukan nama pemilik akun.
- Undangan dicocokkan dengan email akun saat penerima membaca daftar undangannya. Orang yang mendaftar dengan email itu dalam tujuh hari akan melihatnya.
- Notifikasi dalam aplikasi hanya dikirim bila akunnya sudah ada. Tidak ada email keluar ke alamat tanpa akun, supaya fitur ini tidak dapat dipakai mengirim spam.
- Undangan tertunda maksimal 20 per grup.

Risiko yang diterima: email belum diverifikasi, jadi akun yang didaftarkan dengan email orang lain dapat menerima undangan yang ditujukan ke pemilik email aslinya. Dampaknya terbatas pada grup yang diundang, dan butuh admin yang salah mengetik atau menuju alamat yang belum didaftarkan pemiliknya.

### K30. Bergabung kembali dan rotasi kode

Masalah: aturan awal membolehkan LEFT atau REMOVED kembali lewat kode. Anggota yang dikeluarkan admin dapat langsung masuk lagi dengan kode yang sama, sehingga pengeluaran tidak berarti.

Perbaikan:
- LEFT bergabung lewat kode, atau lewat permintaan bila joinRequiresApproval.
- REMOVED hanya dapat kembali lewat permintaan yang disetujui admin (selalu, tanpa melihat pengaturan grup) atau undangan yang diterima.
- Jeda 24 jam sebelum mengajukan lagi, dihitung dari yang lebih akhir antara leftAt (untuk REMOVED) dan decidedAt permintaan terakhir yang ditolak. Undangan tidak terkena jeda karena admin sendiri yang mengundang.
- Admin dapat memutar kode. Kode lama langsung tidak berlaku. Kode baru perlu dibagikan ulang.

### K31. Keluar dan dikeluarkan

Penghalang yang tidak dapat dilewati: pemilik kepemilikan (OWNER harus menyerahkan dulu) dan pemegang dana (K10).

Penghalang yang dapat dilewati admin dengan alasan tercatat (OVERRIDE_LEAVE): saldo tidak nol pada pasangan mana pun. Override hanya lewat aksi dikeluarkan dengan overrideBalance. Keluar sendiri dengan saldo tidak nol tetap diblokir, dan anggota meminta admin. Hasil override adalah REMOVED, bukan LEFT.

Diselesaikan sistem secara otomatis saat seseorang keluar atau dikeluarkan, semuanya tercatat dengan actorId kosong:
- Transaksi DRAFT miliknya dihapus.
- Transaksi miliknya berstatus PENDING_APPROVAL menjadi WITHDRAWN.
- Transaksi ITEMIZED miliknya pada fase CLAIMING difinalisasi sistem (K18). Penalang yang pergi menanggung sisa unit.
- Baris HOLDING miliknya dilepas dan penunjukan OFFERED untuknya menjadi CANCELLED.
- Consent PENDING sebagai peserta menjadi REJECTED. Transaksinya tetap berjalan, dan penalang mengubah daftar peserta bila perlu.
- Suara yang sudah masuk tetap dihitung dan eligibleCount tidak berubah (G2).
- Ledger tidak berubah. Mantan anggota tetap tampil sampai saldonya nol (keputusan 7).

Mengeluarkan admin: admin harus diturunkan lebih dulu oleh OWNER (K12). Aturan yang sama berlaku bila OWNER yang mengeluarkan.

### K32. Batas anggota dan percobaan kode

- Maksimal 50 anggota ACTIVE per grup (usulan, konstanta di constants.js). Pemeriksaan dilakukan saat bergabung, persetujuan permintaan, dan penerimaan undangan.
- Kode grup 6 karakter dapat ditebak. Alfabet kode memuat 32 karakter (huruf A sampai Z tanpa I dan O, angka 2 sampai 9) dan dibangkitkan dengan randomInt dari node:crypto, sehingga ada 32 pangkat 6, yaitu 1.073.741.824 kemungkinan (30 bit). Menebak kode satu grup tertentu dengan batas 960 percobaan per hari per akun berpeluang sekitar 0,00009 persen per hari per akun. Menebak kode grup mana pun lebih mungkin seiring jumlah grup: dengan 100.000 grup sekitar 8,9 persen per hari per akun. Pembatas laju 10 percobaan per 15 menit per pengguna dipasang pada endpoint bergabung sejak Tahap 1, tidak menunggu Tahap 4.
- Pembatas laju per pengguna tidak menghentikan penyerang yang memakai banyak akun. Pengaman utamanya adalah pengaturan kode tersembunyi, persetujuan gabung, dan rotasi kode.

<!-- akhir-bagian-10e -->


### K33. Temuan dari pembacaan group.service.js

Masalah (kode yang sudah berjalan, belum diubah):
- getGroup mengirim email semua anggota kepada setiap anggota (select email). Kontrak 11.1 menyatakan email tidak pernah ditampilkan, dan premis K29 (menguji email terdaftar) runtuh bila email semua anggota sudah terlihat.
- listMyGroups, joinGroup, dan getGroup mengirim seluruh baris Group lewat spread, termasuk code dan createdBy, tanpa memperhatikan codeHidden. Respons yang menyebarkan baris database juga membocorkan kolom baru yang ditambahkan kelak.
- Pemeriksaan keanggotaan diulang dengan cara berbeda di setiap service (group, ledger, payment, receipt). Setelah GroupMember punya status, satu pemeriksaan yang terlewat menjadi lubang akses bagi mantan anggota.
- joinGroup tidak membatasi jumlah anggota.
- Normalisasi kode (huruf besar, spasi) tidak terlihat di service. Pemeriksaannya ada di validator, yang belum dibaca untuk dokumen ini.

Perbaikan:
- Respons selalu disusun dari daftar field eksplisit.
- Satu fungsi requireActiveMember(userId, groupId) dan requireRole dipakai semua service. Tes memeriksa bahwa setiap rute berparameter groupId menolak non-anggota dan mantan anggota.
- Pemeriksaan batas anggota dan penyisipan dilakukan dalam satu transaksi database dengan kunci pada baris Group, supaya dua orang yang bergabung bersamaan pada anggota ke-49 tidak melampaui 50.
- Kode dinormalisasi (trim dan huruf besar) sebelum pencarian, setelah isi validator diperiksa.

### K34. Penandaan dibayar dana tanpa Approval (mengoreksi 6.4 dan K1)

Masalah: 6.4 dan K1 menyebut penandaan dana memakai Approval dengan rule FUND_HOLDER. Pemegang dana adalah pihak yang menandai, jadi ia menyetujui permintaannya sendiri. Approval itu tidak berfungsi.

Perbaikan:
- Approval.subjectType FUND_MARK dan rule FUND_HOLDER dihapus. FUND_MARK tetap ada sebagai action AuditLog.
- Penandaan adalah keputusan langsung pemegang dana. Syaratnya: dana ACTIVE, transaksi ACTIVE, mode EQUAL_ALL, belum dibayar dana, tidak ada revisi PENDING_APPROVAL, tidak ada share dengan consent PENDING, dan baseVersion cocok.
- Syarat consent PENDING ada karena revisi yang menaikkan tanggungan (K22) membiarkan consent tertunda. REVERSAL dan CHARGE dari Dana akan bertumpuk dengan bagian kenaikan yang belum disetujui, tanpa aturan yang jelas tentang bagian itu. Pemegang menunggu consent selesai.
- Dana menutup F, yaitu yang lebih kecil antara saldo dan total transaksi. Jika F lebih kecil dari total, pemegang harus menyatakan acceptPartial secara eksplisit. Itulah persetujuan pembagian sisa yang dimaksud spesifikasi. Jika saldo nol, ditolak (409 fund-insufficient).
- Pencatatan: Transaction.paidFromFund true, Transaction.fundCoveredAmount F, FundEntry SPEND F, dan AuditLog FUND_MARK.
- Transaksi yang sudah dibayar dana tidak dapat direvisi (409 invalid-state). Perubahan hanya lewat takedown lalu pengajuan baru. Alasannya, revisi nominal akan mengubah SPEND dan CHARGE dari dana, dan kenaikan di atas saldo membuka kasus tanpa aturan.
- Pemegang dana yang juga penalang boleh menandai transaksinya sendiri. Pembatasnya: transaksi itu sudah lolos aturan persetujuannya masing-masing, dan baris FUND_MARK memuat penanda selfReimbursed.

### K35. Dana sebagai pihak ledger: perhitungan kasus

Contoh penuh. Empat peserta: pengguna 4 penalang, 5 pemegang dana, 6 dan 7 anggota. Total Rp100.000, bagian awal Rp25.000 masing-masing, saldo dana Rp150.000.
1. REVERSAL atas tiga CHARGE awal (5, 6, dan 7 ke 4, masing-masing Rp25.000).
2. CHARGE dari Dana ke 4 sebesar Rp100.000.
3. FundEntry SPEND Rp100.000. Saldo dana menjadi Rp50.000.
4. Pemegang membayar pengguna 4 lewat pelunasan atas nama dana. Setelah dikonfirmasi pengguna 4, SETTLEMENT Dana ke 4 sebesar Rp100.000 ditulis.

Contoh sebagian. Saldo Rp40.000, acceptPartial true. F adalah Rp40.000 dan sisa Rp60.000 dibagi empat peserta menjadi Rp15.000. REVERSAL atas tiga CHARGE awal, lalu CHARGE baru Rp15.000 dari 5, 6, dan 7 ke 4, CHARGE Dana ke 4 sebesar Rp40.000, dan SPEND Rp40.000. Pengguna 4 menerima Rp40.000 dari dana dan Rp45.000 dari tiga anggota, serta menanggung Rp15.000 sendiri: total Rp100.000. Bila sisa tidak habis dibagi (saldo Rp30.001, sisa Rp69.999), largest remainder dengan tie-break userId menaik (G4): peserta 4, 5, dan 6 mendapat Rp17.500, dan peserta 7 mendapat Rp17.499 (jumlah Rp69.999).

Pemegang dana sama dengan penalang: tidak ada CHARGE dari Dana dan tidak ada SETTLEMENT, karena nilainya impas. SETTLEMENT mewajibkan paymentId, sedangkan tidak ada pelunasan nyata. Yang ditulis hanya REVERSAL atau pergantian CHARGE anggota lain, FundEntry SPEND, dan AuditLog dengan selfReimbursed true.

Anggota yang sudah melunasi sebelum penandaan: pelunasan dicatat per pasangan (keputusan 10), jadi tidak dapat dikaitkan ke satu transaksi. REVERSAL membuat saldo pasangan menjadi kredit untuk anggota itu sesuai K25, tanpa pembatasan tambahan.

Takedown transaksi yang dibayar dana: semua CHARGE aktif terkait dibalik lewat REVERSAL, dan FundEntry SPEND_REVERSAL sebesar fundCoveredAmount memulihkan saldo dana. Bila penalang sudah menerima SETTLEMENT dari dana, saldo pasangan (Dana, penalang) menjadi negatif dan penalang berutang kembali kepada dana. Contoh: CHARGE Rp100.000, SETTLEMENT minus Rp100.000, REVERSAL minus Rp100.000, sehingga N(Dana, penalang) adalah minus Rp100.000. Penalang membayar lewat pelunasan ke dana, yang dikonfirmasi pemegang.

Pelunasan dua arah (mengubah 10.4): dana membayar kreditur (pengirim pemegang, onBehalfOfFund), dan pihak yang berutang kepada dana membayar dana (penerima pemegang, toFund). Pengecualian identitas di 8.1 berlaku untuk kedua arah.

Aritmetika: perkalian dan pembagian proporsional (PPN, pengembalian dana) memakai BigInt, karena hasil kali dua nilai hingga Rp100.000.000 mencapai 10 pangkat 16, melebihi bilangan bulat aman JavaScript (sekitar 9,007 kali 10 pangkat 15). Ini perluasan K7.

### K36. Siklus pemegang dana

- Penunjukan: admin menunjuk, dan dana berstatus PENDING sampai calon menerima. Calon harus anggota ACTIVE dan menerima dalam tujuh hari. Menolak atau kedaluwarsa menutup dana kosong itu (CLOSED), dan admin dapat menunjuk ulang. Pemegang tidak boleh dibebani tanpa persetujuannya, karena penghalang keluar di bawah membuatnya tidak dapat keluar dari grup.
- Serah terima: pemegang menunjuk calon baru, dan pergantian terjadi saat calon menerima. Saldo dan utang Dana tidak berpindah karena Dana adalah pihak ledger tersendiri. Pelunasan PENDING atas nama dana yang sudah dikirim pemegang lama tetap diproses.
- Pergantian oleh admin (pemegang tidak aktif): admin menunjuk dengan alasan wajib. Pemegang lama diberi notifikasi dan tetap pemegang sampai calon menerima. Risiko yang diterima: sistem tidak dapat membuktikan uang tunai berpindah tangan.
- Penghalang keluar (menyempurnakan K10 dan K31):
  - Selama dana belum CLOSED, pemegang tidak dapat keluar atau dikeluarkan. Serah terima yang diterima calon membebaskannya.
  - Setelah dana CLOSED, holderId tetap tercatat sebagai pemegang terakhir. Ia tidak dapat keluar selama Dana masih punya saldo tidak nol pada pasangan mana pun, karena hanya dia yang dapat membayar utang Dana (onBehalfOfFund). Penutupan ditolak selama masih ada pihak yang berutang kepada Dana (K37), jadi yang mungkin tersisa hanya utang Dana kepada pihak lain.
  - Penghalang ini tidak dapat dilewati admin (K31). Jalan keluar bagi pemegang yang tidak aktif sebelum dana ditutup adalah penggantian oleh admin. Risiko yang diterima: pemegang terakhir yang tidak aktif setelah dana CLOSED menahan utang Dana tanpa jalan keluar di sistem.

### K37. Setoran, visibilitas, dan penutupan dana

- Setoran: hanya pemegang. contributorId wajib dan harus anggota ACTIVE (boleh pemegang sendiri), source wajib (teks bebas). Kontributor menerima notifikasi FUND_TOPUP. Tidak ada konfirmasi kontributor. Risiko yang diterima: pemegang dapat mencatat setoran fiktif atas nama orang lain, yang memengaruhi pembagian pengembalian. Pembatasnya: kontributor diberi tahu dan semua pergerakan tercatat.
- Visibilitas: anggota biasa melihat saldo, total terkumpul, total terpakai, utang dana, serta daftar pergerakan (jenis, nominal, waktu, keterangan sumber) tanpa nama kontributor dan tanpa pelaku. Mereka melihat kontribusinya sendiri. Admin dan pemegang melihat nama kontributor. Alasannya, bila pemegang ikut menyetor, daftar kontributor akan membuka identitasnya. Keterangan sumber adalah teks bebas dan dapat memuat nama, itu risiko yang diterima.
- Penutupan: hanya pemegang, dan ditolak bila masih ada pihak yang berutang kepada dana (409 fund-has-receivables). Sisa saldo dibagi proporsional terhadap total setoran tiap kontributor dengan largest remainder, tie-break userId menaik, BigInt. Untuk tiap kontributor ditulis CHARGE Dana ke kontributor dan FundEntry REFUND, lalu pemegang membayar lewat pelunasan atas nama dana. Contoh: setoran pengguna 5, 6, dan 7 masing-masing Rp50.000 (total Rp150.000), terpakai Rp50.000, sisa Rp100.000, pengembalian Rp33.334, Rp33.333, dan Rp33.333 (jumlah Rp100.000).
- Dana CLOSED tidak menerima setoran maupun penandaan. Grup boleh membuat dana baru. Utang Dana yang tersisa tetap diselesaikan pemegang terakhir (penghalang keluar di K36).

<!-- akhir-bagian-10f -->

### K38. Nomor urut pesan per grup tanpa celah

Masalah: kolom identity di SQL Server tidak menjamin urutan commit sama dengan urutan nilainya. Dua pengirim bersamaan dapat memperoleh nomor 101 dan 102, lalu transaksi 102 commit lebih dulu. Klien yang menyusul dengan after=102 melewatkan pesan 101 selamanya. Pada pesan yang permanen dan tidak dapat diperbaiki, ini tidak boleh terjadi.

Perbaikan:
- Tabel GroupChat: groupId (kunci utama), lastSeq (BigInt, awal 0). Dibuat dalam transaksi yang sama dengan pembuatan grup.
- Message memakai kunci utama (groupId, seq), tanpa id global. Nomor seq adalah id pesan di API.
- Menulis pesan dalam satu transaksi: UPDATE GroupChat SET lastSeq = lastSeq + 1 OUTPUT inserted.lastSeq WHERE groupId = @groupId, lalu INSERT Message dengan seq hasilnya, lalu commit. Kunci baris yang diambil UPDATE bertahan sampai commit atau rollback, sehingga pengirim lain menunggu, urutan commit sama dengan urutan seq, dan rollback ikut membatalkan kenaikan sehingga tidak ada celah.
- Aturan penguncian: tidak ada kunci lain yang diminta setelah kunci GroupChat diambil, untuk mencegah deadlock. Transaksi domain yang membuat kartu sistem (K40) menulis kartunya sebagai pernyataan terakhir sebelum commit supaya kunci tertahan sebentar. Unggahan berkas ke Blob dilakukan sebelum transaksi dimulai.
- Siaran ke klien dilakukan setelah commit. Bila server mati antara commit dan siaran, klien menyusul lewat REST.
- ChatReadState: groupId, userId, lastReadSeq (BigInt), updatedAt, kunci utama (groupId, userId). Dibuat pada setiap aktivasi keanggotaan dengan lastReadSeq sama dengan lastSeq saat itu, supaya anggota baru tidak menerima ribuan pesan belum dibaca. lastReadSeq hanya naik.
- Biaya: pengiriman pesan dalam satu grup berjalan berurutan. Pada batas 50 anggota dan batas laju K41, ini dapat diterima.

Contoh: grup 12 dengan lastSeq 120. Pengguna A dan B mengirim bersamaan. A memperoleh 121 dan menahan kunci. B menunggu, lalu memperoleh 122 setelah A commit. Kedua pesan terurut.

Contoh belum dibaca: lastSeq 120 dan lastReadSeq 115. Pesan 116 sampai 120 berjumlah 5, dua di antaranya milik pengguna itu sendiri, sehingga belum dibaca berjumlah 3.

### K39. Jendela pesan yang terlihat

Masalah: spesifikasi hanya menyatakan mantan anggota tanpa akses chat. Belum diatur apa yang dilihat anggota baru atau yang bergabung kembali. Riwayat chat lama dapat memuat percakapan antar mantan anggota, atau kartu berisi nama dan nominal yang tidak ditujukan kepada anggota baru.

Perbaikan (default, menunggu konfirmasi):
- GroupMember.activeSince diisi pada setiap aktivasi: bergabung, bergabung kembali, permintaan disetujui, undangan diterima. joinedAt tetap tanggal pertama.
- Pesan terlihat bagi anggota ACTIVE hanya bila createdAt lebih besar atau sama dengan activeSince. Pesan sebelum itu tidak muncul di daftar, jumlah belum dibaca, siaran, maupun unduhan gambar.
- Anggota yang keluar lalu bergabung kembali tidak melihat pesan dari periode sebelumnya. Ini konsekuensi yang diterima demi aturan yang sederhana.
- Riwayat transaksi tetap terlihat penuh oleh semua anggota ACTIVE (7.4). Kartu yang terbit sebelum activeSince tidak tampil di chat, tetapi anggota baru tetap dapat membuka transaksinya dari riwayat dan ikut memilih item.

Contoh: Dina memiliki activeSince 2026-10-10T09:00:00.000Z. Pesan pada 08:59:59 tidak terlihat. Pesan pada 09:00:00 terlihat.

### K40. Kartu sistem dan pencatatan

- Hanya dua jenis kartu: ITEM_PICK (cardRef berisi transactionId, terbit saat transaksi ITEMIZED menjadi ACTIVE, 7.1) dan APPROVAL (cardRef berisi approvalId, terbit saat Approval dibuat, 6.3). Tidak ada pesan sistem berupa teks, termasuk pengumuman bergabung atau keluar. Pengumuman akan membuka pengeluaran anggota dan membanjiri chat.
- Permintaan consent peserta (K23) tidak pernah menjadi kartu. Chat dibaca seluruh anggota dan akan mengumumkan siapa yang diminta menanggung dan siapa yang menolak. Consent hanya lewat notifikasi CONSENT_REQUEST.
- Kartu hanya penanda berisi jenis dan id. Datanya dibaca lewat REST sehingga kartu selalu mutakhir, dan status akhir (REJECTED, EXPIRED, TAKEN_DOWN) tampil pada kartu lama.
- Satu kartu per subjek (unik groupId, cardType, cardRef). Kartu ditulis dalam transaksi yang sama dengan peristiwanya, sebagai pernyataan terakhir (K38). Bila transaksi gagal tidak ada kartu yatim, dan bila berhasil tidak ada kartu ganda.
- Tidak ada endpoint klien untuk membuat kartu.
- Semua anggota ACTIVE dapat membaca Approval grupnya, karena kartunya berada di chat bersama. canVote tetap dihitung server (6.3).
- Pesan chat dan ChatReadState tidak ditulis ke AuditLog. Message adalah catatan permanen itu sendiri, dan penulisan ganda hanya membesarkan riwayat. Ini pengecualian atas K19.

### K41. Konten, batas, dan risiko pesan permanen

- Teks: dipangkas. Karakter kontrol (U+0000 sampai U+001F kecuali baris baru dan tab, serta U+007F sampai U+009F) dan pengatur arah teks (U+202A sampai U+202E, serta U+2066 sampai U+2069) dibuang. Pesan kosong ditolak. Batas 2000 karakter Unicode (code point). Kolom NVarChar(4000) cukup untuk kasus terburuk, yaitu 2000 code point yang masing-masing dua unit UTF-16 (2000 kali 2 sama dengan 4000).
- Gambar: JPEG, PNG, atau WebP dari byte awal, maksimal 5 MB. SVG ditolak karena dapat memuat skrip. Disimpan di container chat dengan nama acak, dan hanya dialirkan backend setelah pemeriksaan keanggotaan dan jendela K39. Server tidak mendekode gambar pada tahap ini.
- Batas laju (usulan): 20 pesan teks per menit dan 5 gambar per 5 menit per pengguna per grup. Dipasang bersama chat di Tahap 3, tidak menunggu Tahap 4, karena spam tidak dapat dihapus.
- Unggahan yatim: bila Blob berhasil tetapi transaksi database gagal, server menghapus blob itu. Job pembersih (Tahap 4) menyapu sisanya.
- Risiko yang diterima (mengikuti spesifikasi: pesan permanen, tanpa edit dan hapus): pesan atau gambar yang terkirim keliru, bersifat pribadi, atau melanggar hukum tidak dapat ditarik, termasuk oleh admin. Rancangan memungkinkan penambahan kelak tanpa mengubah Message, yaitu tabel terpisah MessageHidden (groupId, seq, hiddenBy, reason, createdAt) yang menyembunyikan isi dari anggota sambil menyimpan aslinya. Tidak dibangun sekarang. Disarankan ke frontend: konfirmasi sebelum mengirim gambar.
- EXIF: gambar dapat membawa metadata lokasi. Server tidak membuangnya pada tahap ini. Frontend dapat menghapusnya dengan menggambar ulang gambar ke canvas sebelum mengunggah (sekaligus mengecilkan ukuran), tetapi server tidak dapat mengandalkan itu.
- Pertumbuhan penyimpanan tidak dibatasi, karena pesan permanen dan grup tidak dapat dihapus. Dicatat sebagai risiko operasional.
- Chatbot memperlakukan isi chat sebagai data tak tepercaya (bagian chatbot).

<!-- akhir-bagian-10g -->

### K42. Format error validasi lolos dari penggantian (koreksi atas 4.1)

Masalah: validate.js membalas langsung dengan { error: "validation-error", details: [...] } tanpa melalui errorHandler. Kode validation-error tidak ada di tabel migrasi 4.1 (terlewat saat tabel itu ditulis dari pembacaan errorHandler dan service). Saat format error diganti ke RFC 9457, jalur ini akan tertinggal dengan format lama, dan daftar kesalahan per field tidak punya padanan.

Perbaikan:
- validate melempar HttpError dengan code validation-failed dan field errors, yaitu daftar { field, message } dengan field dari path zod yang digabung titik. Tidak ada lagi middleware yang menulis respons error sendiri. Semua error melewati satu errorHandler.
- Tes memeriksa bahwa setiap respons non-2xx yang dapat dipicu (validasi, id salah, JSON rusak, token salah, berkas terlalu besar) bertipe application/problem+json.
- Baris validation-error ditambahkan ke tabel 4.1.

### K43. Pendaftaran membuka status email (mengoreksi klaim K29)

Masalah: K29 melindungi endpoint undangan agar tidak dipakai menguji email terdaftar, dan menyatakan hal itu tidak terbuka. Klaim itu terlalu kuat. POST /api/auth/register mengembalikan 409 email-taken, sehingga siapa pun dapat menguji email terdaftar tanpa membuat grup. K29 hanya menutup satu jalur dari dua.

Perbaikan:
- Jalur register tidak dihilangkan. Menutupnya menuntut verifikasi email (pesan yang sama untuk email baru dan lama, lalu tautan ke pemilik email), yang di luar cakupan. Pengguna perlu tahu bahwa emailnya sudah dipakai.
- Pendaftaran dan login dibatasi lajunya (K47).
- Login membalas pesan yang sama untuk email tidak dikenal dan password salah, dan memakai hash palsu agar waktu respons tidak membedakan keduanya (sudah berjalan).
- Risiko yang diterima: status email terdaftar dapat diuji dalam batas laju. Perlindungan K29 diperbaiki rumusannya: fitur undangan tidak dapat dipakai sebagai alat uji, tetapi pengujian lewat pendaftaran tetap mungkin.

### K44. Validasi input akun

- Password: panjang maksimum 72 byte UTF-8, bukan 72 karakter. bcrypt hanya memakai 72 byte pertama. Satu huruf e beraksen adalah 2 byte, jadi 36 huruf sama dengan 72 byte, dan emoji 4 byte hanya muat 18 buah. Skema zod yang memakai max(72) menghitung unit UTF-16, sehingga 36 emoji (panjang 72, tetapi 144 byte) lolos. Perilaku versi bcryptjs terpasang terhadap input lebih panjang dari 72 byte tidak diperiksa untuk dokumen ini. Perbaikan: validasi dengan Buffer.byteLength lebih kecil atau sama dengan 72, ditambah panjang minimum 8 karakter. Password tidak dipangkas.
- Email: dipangkas dan diubah ke huruf kecil (sudah berjalan, dan penting untuk mencocokkan undangan, K29). Ditambah batas panjang maksimal 254 karakter.
- Field phone dihapus dari registerSchema dan dari service register karena No. HP dibatalkan. Field yang tidak dikenal dibuang oleh zod.
- Nama: dipangkas, 1 sampai 100 karakter (sudah berjalan). Teks nama adalah data tak tepercaya (2.2).

### K45. Model token, dan hal yang sengaja tidak ada

Token akses:
- JWT berklaim sub, iat, dan exp, dengan algoritma dipaku HS256 pada penandatanganan dan verifikasi. Kode sekarang tidak menyebut algoritma, dan default versi terpasang tidak diperiksa.
- requireAuth tidak membaca database. Konsekuensinya, penggantian password tidak mencabut token akses yang sudah beredar sampai kedaluwarsa. Setelah refresh token tersedia, masa berlakunya 15 menit, sehingga jendela risikonya 15 menit.
- Variabel lingkungan JWT_EXPIRES_IN berubah dari 1h menjadi 15m pada Tahap 2.

Yang sengaja tidak dibuat (keputusan produk, menunggu konfirmasi):
- Penghapusan akun: akun dirujuk ledger dan riwayat, sehingga tidak dapat dihapus. Sama seperti grup.
- Penggantian email: email adalah penghubung undangan (K29) dan belum diverifikasi. Mengganti email sama dengan mengambil alih undangan orang lain.
- Pemulihan kata sandi: tidak ada. Pengguna yang lupa password tidak dapat memulihkan akunnya. Infrastruktur email sudah ada (outbox, SMTP), jadi ini kandidat Tahap 4 bila waktu ada. Risiko yang diterima sampai saat itu.

Yang dibuat: penggantian password dengan password lama (14.4), yang mencabut semua refresh token (K46).

### K46. Refresh token (Tahap 2)

Tabel RefreshToken: id, userId, familyId (UUID), tokenHash (SHA-256 heksadesimal, unik), createdAt, expiresAt, usedAt, revokedAt, replacedByTokenId.

- Token adalah 32 byte acak (crypto.randomBytes) yang dikodekan base64url. Hanya hash-nya yang disimpan.
- Masa berlaku absolut 30 hari sejak login. Rotasi mewarisi expiresAt token sebelumnya, tidak memperpanjangnya, supaya sesi pasti berakhir.
- Rotasi: setiap refresh yang sah menandai usedAt dan menerbitkan pasangan token baru dalam familyId yang sama. Penandaan atomik: UPDATE dengan syarat usedAt kosong, revokedAt kosong, dan expiresAt belum lewat, lalu periksa jumlah baris terdampak sama dengan 1.
- Deteksi pemakaian ulang: token yang sudah usedAt dan dipakai lagi mencabut seluruh keluarga (revokedAt), dan jawabannya 401 refresh-reuse. Pengguna harus login ulang di perangkat itu. Maksudnya, token yang dicuri dan dipakai bersama pemilik asli terdeteksi.
- Refresh bersamaan dari dua tab dianggap pemakaian ulang dan mengeluarkan pengguna. Karena itu klien wajib single-flight (satu permintaan refresh pada satu waktu, tab lain menunggu hasilnya).
- Logout mencabut keluarga. Penggantian password mencabut semua keluarga milik pengguna. Respons penggantian password berisi pasangan token baru untuk perangkat yang melakukannya.
- Pengiriman: refresh token dikirim dan diterima di body JSON, bukan cookie, karena domain penyebaran frontend dan API belum diketahui (cookie lintas situs butuh SameSite None dan penanganan CSRF). Akibatnya frontend menyimpan token, dan risiko XSS diterima. Mitigasi: CSP, tidak memakai dangerouslySetInnerHTML, dan semua teks pengguna dirender sebagai teks (2.2). Bila kelak frontend dan API satu situs, cookie httpOnly menjadi alternatif.
- Baris RefreshToken yang kedaluwarsa dibersihkan job terjadwal (Tahap 4). Tabel ini bukan catatan audit dan boleh dihapus.
- Aksi auth (login, refresh, logout, penggantian password) ditulis ke AuditLog tingkat pengguna tanpa groupId, atau log aplikasi, dengan alamat IP. Pilihan penyimpanannya ditetapkan saat implementasi dan tidak dijanjikan sebagai riwayat grup.

### K47. Batas laju dan alamat IP di belakang proxy

- Login: 10 percobaan per 15 menit per pasangan (IP, email), dan 50 per 15 menit per IP. Pasangan itu berarti paling banyak 40 percobaan per jam per pasangan. Pembatas per email saja tidak dipakai karena penyerang dapat mengunci akun korban dengan sengaja mengirim percobaan gagal.
- Pendaftaran: 10 per jam per IP.
- Refresh: 60 per 15 menit per IP. Penggantian password: 5 per 15 menit per pengguna. Semuanya usulan.
- Di Azure App Service, Express melihat IP proxy kecuali trust proxy dikonfigurasi. Konfigurasi yang salah punya dua akibat: semua pengguna dianggap satu IP sehingga satu pembatas memblokir semua orang, atau header X-Forwarded-For yang dipalsukan membuat pembatas mudah dilewati. Jumlah lompatan proxy yang dipercaya diverifikasi saat penyebaran. Tes lokal memakai header langsung. Hal ini dicatat sebagai pekerjaan Tahap 4 yang tidak boleh dilewatkan.
- Pembatas disimpan di memori proses (satu instance dulu). Tidak berlaku bila skala horizontal.

<!-- akhir-bagian-10h -->

### K48. Tiga fitur akun masuk (menggantikan bagian "Yang sengaja tidak dibuat" pada K45)

Masalah: K45 menyatakan tidak ada pemulihan kata sandi, ganti email, dan hapus akun, dengan alasan keamanan dan cakupan. Pengguna yang lupa password kehilangan akunnya, dan produk tanpa fitur itu tidak layak untuk pengguna sungguhan. Alasan keamanan bukan alasan menolak bila jebakannya sudah ditutup di rancangan.

Keputusan:
- Pemulihan kata sandi: Tahap 2, bersama refresh token (K50).
- Ganti email: Tahap 3 (K51).
- Hapus akun lewat anonimisasi: Tahap 4 (K52).
- Verifikasi email tidak diwajibkan saat pendaftaran maupun untuk menerima undangan (default diterima tim, menunggu konfirmasi bila tafsirannya keliru). Risiko K29 tetap: akun yang didaftarkan dengan email orang lain dapat menerima undangan yang ditujukan ke pemilik aslinya. Alamat baru pada ganti email terverifikasi karena pemiliknya harus membuka tautan, tetapi akun tidak menyimpan penanda terverifikasi.

Ketergantungan dan perubahan ERD:
- Layanan pengiriman email produksi belum diputuskan (menunggu instruksi asisten praktikum bersama Azure). Mailpit hanya untuk pengembangan. Tanpa layanan itu, alur reset, konfirmasi ganti email, dan pemberitahuan hanya berjalan lokal.
- Variabel lingkungan APP_BASE_URL berisi alamat frontend (https di produksi) untuk menyusun tautan.
- Tabel AccountToken: id, userId, purpose (PASSWORD_RESET atau EMAIL_CHANGE), tokenHash (SHA-256 heksadesimal, unik), newEmail (hanya EMAIL_CHANGE, huruf kecil), createdAt, expiresAt, usedAt, revokedAt.
- User.deletedAt (kosong untuk akun aktif).
- EmailOutbox: toUserId menjadi opsional dan ditambah toEmail (wajib), karena email konfirmasi ganti email dikirim ke alamat yang belum menjadi milik akun mana pun.
- PaymentMethod.accountNo, accountName, dan provider dibuat nullable untuk anonimisasi.
- Payload EmailOutbox dapat memuat token mentah (di dalam tautan). Payload dikosongkan saat status SENT atau FAILED akhir dan tidak pernah ditulis ke log. Selama menunggu pengiriman, kebocoran basis data membuka token yang masih berlaku, dan masa berlaku yang pendek membatasi risikonya.
- Template email: PASSWORD_RESET, PASSWORD_CHANGED, EMAIL_CHANGE_CONFIRM (ke alamat baru), EMAIL_CHANGE_NOTICE (ke alamat lama saat permintaan), EMAIL_CHANGED (ke alamat lama setelah selesai), dan ACCOUNT_DELETED (ke alamat lama, dibuat sebelum anonimisasi). Email tidak memuat password maupun nomor rekening.

### K49. Transport refresh token dua mode, dan toleransi refresh bersamaan (mengubah K46)

Masalah 1: domain penyebaran belum diketahui. Cookie httpOnly lebih aman daripada body karena JavaScript tidak dapat membacanya, tetapi hanya andal bila frontend dan API satu situs. Memilih salah satu sekarang berarti menebak.

Perbaikan 1:
- Variabel lingkungan REFRESH_TOKEN_TRANSPORT bernilai body (bawaan) atau cookie. Respons membawa refreshMode: NONE (sebelum Tahap 2), BODY, atau COOKIE. Klien menyesuaikan diri.
- Mode cookie: refresh_token, HttpOnly, Secure, SameSite=Strict, Path=/api/auth, Max-Age sama dengan sisa detik sampai masa berlaku absolut (maksimal 2.592.000 detik, yaitu 30 hari).
- Cookie lintas situs (SameSite=None) tidak dibangun. Bila frontend dan API lintas situs, gunakan mode body.
- Pada mode cookie, refresh dan logout wajib membawa header X-Requested-With bernilai patunganku. Ini lapisan CSRF tambahan: permintaan lintas asal dengan header khusus memicu preflight CORS.
- Produksi: CORS_ORIGIN harus berisi daftar asal yang persis, bukan tanda bintang. Nilai bawaan sekarang adalah tanda bintang. env.js menolak tanda bintang bila NODE_ENV adalah production, dan mode cookie mengirim Access-Control-Allow-Credentials.
- Perilaku cookie Secure pada http://localhost berbeda antar peramban dan belum diuji untuk dokumen ini. Bawaan lokal adalah mode body, dan mode cookie diuji di lingkungan https.
- Risiko yang diterima: dua jalur kode yang harus dites. Mode cookie menutup pencurian token oleh XSS, tetapi tidak penyalahgunaan sesi selama halaman terbuka.

Masalah 2: K46 menyatakan dua refresh bersamaan dianggap pemakaian ulang dan mengeluarkan pengguna. Dua tab terbuka yang kebetulan refresh bersamaan akan mengeluarkan pengguna tanpa serangan apa pun.

Perbaikan 2 (menggantikan butir itu di K46):
- Bila token yang sudah usedAt dipakai lagi dalam 10 detik sejak usedAt, dan token penggantinya (replacedByTokenId) belum dipakai serta keluarga belum dicabut: 409 refresh-conflict. Keluarga tidak dicabut dan tidak ada token yang diterbitkan. Klien membaca ulang token tersimpan (mode cookie terkirim otomatis) lalu mengulang sekali.
- Selain itu (lewat 10 detik, atau penggantinya sudah dipakai): pemakaian ulang sejati, 401 refresh-reuse dan seluruh keluarga dicabut.
- Respons 409 tidak mengeluarkan token. Pencuri yang memutar ulang token lama dalam 10 detik tidak mendapat apa pun, dan akibatnya hanya deteksi pencurian yang tertunda.
- Klien tetap mengunci antar tab dengan navigator.locks bila tersedia. Dukungan peramban lama tidak diperiksa.

Contoh: refresh pertama pukul 09:00:00 menandai usedAt dan menerbitkan token T2. Permintaan berikutnya dengan T1 pukul 09:00:03 (selisih 3 detik) menghasilkan 409 refresh-conflict. Permintaan dengan T1 pukul 09:00:12 (selisih 12 detik) menghasilkan 401 refresh-reuse dan keluarga dicabut.

<!-- akhir-bagian-10h2 -->

### K50. Pemulihan kata sandi (Tahap 2)

Jebakan yang ditutup:
- Permintaan selalu dijawab 202 dengan isi sama untuk email terdaftar dan tidak. Catatan jujur: karena pendaftaran sudah membuka status email (K43), kesamaan ini bukan perlindungan penuh, melainkan agar fitur ini tidak menambah jalur uji baru. Perbedaan waktu respons tidak diratakan.
- Token berupa 32 byte acak, hanya hash yang disimpan, berlaku 1 jam, sekali pakai. Permintaan baru mencabut token reset yang belum dipakai milik akun itu.
- Tautan berbentuk APP_BASE_URL ditambah /reset-password#token=nilai. Fragmen tidak dikirim ke server dan tidak masuk header Referer. Frontend membaca fragmen, menghapusnya dengan history.replaceState sebelum permintaan jaringan apa pun, dan tidak mencatatnya.
- Batas: 3 per jam per pasangan (IP, email) dan 10 per jam per IP, dengan 429 rate-limited. Pengiriman email sendiri dibatasi diam-diam 3 per jam per akun (tetap 202, tidak ada email) untuk mencegah pembanjiran email korban dari banyak IP. Akibat yang diterima: penyerang dapat menahan pemulihan korban dengan menghabiskan batas itu secara terus-menerus.
- Akun terhapus tidak menerima email, dan permintaannya tetap dijawab 202.

Hasil reset: password diganti, token ditandai usedAt, semua AccountToken lain yang belum dipakai milik akun dicabut, semua refresh token dicabut, dan email PASSWORD_CHANGED dikirim ke alamat akun. Tidak ada login otomatis. Token akses yang sudah beredar berlaku sampai kedaluwarsa, paling lama 15 menit (K45).

### K51. Ganti email (Tahap 3)

Mengapa berbahaya bila sembarangan: email adalah kunci undangan (K29). Mengganti email tanpa bukti kepemilikan sama dengan merebut undangan orang lain.

Penutupnya:
- Wajib password. Token dikirim ke alamat baru, dan email baru berlaku hanya setelah tautan dibuka.
- Token berlaku 24 jam, sekali pakai, mengikat userId dan newEmail. Permintaan baru mencabut token ganti email sebelumnya.
- Alamat baru yang sudah dipakai akun lain: 409 email-taken pada permintaan dan pada konfirmasi. Ini membuka status email, setara pendaftaran (K43).
- Konfirmasi tidak membutuhkan sesi login: kepemilikan token berarti kepemilikan kotak surat baru, dan permintaannya sudah diautentikasi dengan password saat dibuat. Tautan yang dibuka di perangkat lain tetap berfungsi.
- Saat permintaan dibuat, EMAIL_CHANGE_NOTICE dikirim ke alamat lama (alamat baru disamarkan). Saat selesai, email berganti (huruf kecil), semua refresh token dicabut sehingga semua perangkat login ulang, dan EMAIL_CHANGED dikirim ke alamat lama.

Batas yang jujur:
- Penyerang yang sudah memiliki password dan kotak surat baru dapat mengambil alih akun. Pemberitahuan ke alamat lama hanya peringatan dini, bukan pencegahan, dan tidak ada tautan pembatalan.
- Undangan tertunda ke alamat lama tidak lagi terlihat oleh akun ini. Alamat lama menjadi bebas didaftarkan siapa pun, yang lalu melihat undangan yang ditujukan ke alamat itu. Ini risiko K29 dan K43 yang sama dan diterima.

### K52. Hapus akun lewat anonimisasi (Tahap 4)

Prinsip: ledger, riwayat, dan chat bersifat permanen dan merujuk akun ini. Penghapusan fisik merusak catatan orang lain.

Syarat (tidak dapat dilewati admin, berbeda dengan K31): bukan OWNER di grup mana pun, bukan pemegang dana (termasuk pemegang terakhir dana CLOSED yang masih punya saldo tidak nol, K36), saldo nol pada semua pasangan di semua grup termasuk grup yang sudah ditinggalkan, dan tidak ada pelunasan PENDING sebagai pengirim maupun penerima. Alasannya: menghapus akun tidak boleh menjadi jalan keluar dari utang.

Dalam satu transaksi database:
1. Keluar dari semua grup dengan penyelesaian otomatis seperti K31 (DRAFT dihapus, PENDING_APPROVAL ditarik, ITEMIZED CLAIMING difinalisasi, HOLDING dilepas, penunjukan dibatalkan, consent PENDING menjadi REJECTED). Penunjukan pemegang dana yang tertunda dibatalkan.
2. Email ACCOUNT_DELETED dimasukkan ke outbox untuk alamat lama sebelum anonimisasi.
3. Anonimisasi: email menjadi deleted-ID@deleted.invalid (ID adalah id pengguna), name menjadi Pengguna terhapus, passwordHash diganti hash dari 32 byte acak yang dibuang, notifyByEmail false, deletedAt diisi.
4. PaymentMethod dinonaktifkan dan accountNo, accountName, provider dikosongkan (baris dipertahankan karena pelunasan lama merujuknya).
5. Notification dan EmailOutbox yang belum terkirim dihapus. RefreshToken dan AccountToken dihapus. Undangan tertunda ke alamat lama menjadi CANCELLED.

Yang tetap ada: baris ledger, transaksi, riwayat, isi dan gambar chat, struk, dan bukti pelunasan, tampil dengan nama Pengguna terhapus dan keanggotaan LEFT. Gambar bukti transfer dan chat mungkin memuat data pribadi. Semuanya tidak dihapus karena menjadi bukti bagi pihak lawan dan karena pesan bersifat permanen. Penghapusan data pribadi yang penuh bertabrakan dengan keputusan pesan permanen, jadi dicatat sebagai keterbatasan. Isi UU Pelindungan Data Pribadi tidak diperiksa untuk dokumen ini, dan perlu ditanyakan ke dosen atau asisten bila dibutuhkan.

Akibat lain:
- Penghapusan tidak dapat dipulihkan. Alamat email lama menjadi bebas didaftarkan ulang sebagai akun baru, yang tidak punya hubungan dengan data lama.
- Token akses yang sudah beredar berlaku sampai kedaluwarsa (paling lama 15 menit). Endpoint /api/me menolak akun terhapus dengan 401 unauthorized, dan endpoint grup menolak karena keanggotaan LEFT.
- Aksi dicatat di log keamanan tingkat pengguna (K46) beserta alamat IP.

<!-- akhir-bagian-10i -->
