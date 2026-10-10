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
| 8 | Gabung hanya lewat kode grup. Admin boleh menambah email yang sudah terdaftar. Admin mengatur: sembunyikan kode dari anggota biasa, dan gabung butuh persetujuan atau tidak. |
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
| User | id, email (unik), passwordHash, name, createdAt. Kolom phone dihapus. |
| Group | id, name, code (unik), createdBy, createdAt. Tambah codeHidden (default false), joinRequiresApproval (default false), settleSimplify (default true). |
| GroupMember | id, groupId, userId, role (OWNER, ADMIN, MEMBER), status (PENDING, ACTIVE, LEFT, REMOVED), joinedAt, leftAt, leftReason. Unik (groupId, userId). Baris tidak pernah dihapus. Anggota yang bergabung kembali memakai baris yang sama (status kembali ACTIVE, riwayat di AuditLog). Filtered unique index: satu OWNER aktif per grup (role OWNER dan status ACTIVE). |
| Transaction | id, groupId, payerId (penalang), description, amount, mode (EQUAL_ALL, EQUAL_SUBSET, ITEMIZED), status (PENDING_APPROVAL, ACTIVE, REJECTED, EXPIRED, TAKEN_DOWN), receiptUrl, receiptStatus (PENDING, VERIFIED, FAILED, NEEDS_REVIEW), imageSha256, fingerprint, paidFromFund, version, expiresAt, createdAt. Indeks (groupId, imageSha256) dan (groupId, fingerprint). |
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

id, groupId, actorId, entity, entityId, action (misalnya REVISE, TAKEDOWN, OVERRIDE_LEAVE, ROLE_CHANGE, FUND_MARK), oldValue (JSON), newValue (JSON), reason, createdAt. Alasan wajib untuk REVISE, TAKEDOWN, dan OVERRIDE_LEAVE (ditegakkan di service). Indeks (groupId, createdAt). Selisih hasil AI dan revisi admin untuk data akurasi dibaca dari tabel ReceiptExtraction versi, bukan dari tabel terpisah.

### 6.3 Struk dan klaim item

**ReceiptExtraction** (satu baris per versi, tidak diubah)

id, transactionId, version, source (AI atau ADMIN), createdBy, merchant, purchasedAt, subtotal, discount, service, tax, taxMode (EXCLUSIVE, INCLUSIVE, UNKNOWN), total, confidence, arithmeticOk, rawJson, model, promptVersion, createdAt. Unik (transactionId, version). Versi aktif adalah versi tertinggi. Revisi admin membuat versi baru sehingga hasil asli AI tetap tersimpan. Jika taxMode UNKNOWN atau arithmeticOk salah, receiptStatus menjadi NEEDS_REVIEW.

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

id, itemId, assigneeId, status (OFFERED, ACCEPTED, DECLINED, CANCELLED), offeredBy, offeredAt, decidedAt. Penerimaan pertama dilakukan atomik dengan UPDATE bersyarat. Kandidat lain otomatis CANCELLED (keputusan 6).

<!-- akhir-bagian-6a -->

### 6.4 Persetujuan, revisi, dan notifikasi

**Approval**

id, groupId, subjectType (TRANSACTION, REVISION, FUND_MARK), subjectId, rule, requestedBy, eligibleCount, required, status (OPEN, APPROVED, REJECTED, EXPIRED), expiresAt, decidedAt, createdAt.

Nilai rule dan aturan keputusannya:

| rule | Pemilih yang sah | required | Cara memutuskan |
|---|---|---|---|
| ADMIN_ANY | Semua admin (OWNER dan ADMIN) aktif selain pengaju | 1 | Penentu tunggal: suara pertama langsung memutuskan (setuju atau tolak). |
| ADMIN_OTHER | Sama dengan ADMIN_ANY, dipakai bila pengaju adalah admin | 1 | Penentu tunggal. |
| QUORUM_20 | Semua anggota aktif selain pengaju | min(5, max(1, ceil(n / 5))) | Kuorum biasa. |
| MAJORITY | Semua anggota aktif selain pengaju | floor(n / 2) + 1 | Kuorum biasa. |
| FUND_HOLDER | Pemegang dana | 1 | Penentu tunggal. |

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

id, groupId (unik), holderId, status (ACTIVE, CLOSED), createdBy, createdAt. Saldo dana adalah SUM atas FundEntry (TOPUP bernilai positif, SPEND dan REFUND bernilai negatif).

**FundEntry** (append-only)

id, fundId, kind (TOPUP, SPEND, REFUND), amount (BigInt, selalu positif), contributorId (opsional, wajib untuk TOPUP), source (teks keterangan sumber, wajib untuk TOPUP), transactionId (wajib untuk SPEND), createdBy, createdAt.

Alur penandaan dibayar dana (K1):

1. Hanya pemegang dana yang dapat menandai, dan hanya untuk transaksi mode EQUAL_ALL berstatus ACTIVE.
2. Dalam satu transaksi database, baris GroupFund dikunci (UPDLOCK), saldo dihitung, lalu dana menutup sebesar min(saldo, total transaksi).
3. CHARGE para anggota dibalik (REVERSAL). Ditulis CHARGE dari Dana ke penalang sebesar bagian yang ditutup dana. Sisa yang tidak tertutup dibagi merata ke anggota dengan persetujuan pemegang dana (rule FUND_HOLDER).
4. FundEntry SPEND ditulis sebesar bagian yang ditutup (dana dicadangkan).
5. Bila pemegang dana sekaligus penalang, SETTLEMENT dari Dana ke penalang ditulis otomatis dan AuditLog (action FUND_MARK) wajib dicatat. Bila bukan, pemegang membayar penalang lewat PaymentConfirmation dengan fundId, yang dikonfirmasi penalang seperti pelunasan biasa.
6. Pemegang dana tidak bisa keluar dari grup sebelum menyerahkan dana ke pemegang baru atau menutup dana. Penutupan mengembalikan sisa proporsional terhadap kontribusi lewat FundEntry REFUND (K10).

### 6.6 Chat, pengingat, dan pendukung

**Message** (append-only)

id, groupId, senderId (kosong untuk pesan sistem), kind (TEXT, IMAGE, SYSTEM_CARD), body (maksimal 2000 karakter), imageUrl, cardType (APPROVAL, ITEM_PICK, dan sejenisnya), cardRef (id subjek kartu), createdAt. Indeks (groupId, id) untuk pagination berbasis kursor. Mantan anggota tidak punya akses baca maupun tulis. Gambar maksimal 5 MB dengan tipe divalidasi dari byte awal (keputusan 12). Tidak ada edit atau hapus pesan di tahap awal. Kartu sistem hanya merujuk id, sedangkan datanya dibaca dari tabel sumbernya sehingga kartu selalu mutakhir.

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
| (baru) | OFFERED | Penalang menunjuk anggota atas item yang belum terpilih setelah 24 jam. |
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
| (baru) | ACTIVE | Gabung lewat kode tanpa persetujuan, atau disetujui admin, atau ditambah admin lewat email terdaftar. |
| (baru) | PENDING | Gabung lewat kode pada grup dengan joinRequiresApproval. |
| PENDING | ACTIVE atau REMOVED | Disetujui atau ditolak admin. |
| ACTIVE | LEFT | Keluar sendiri. Hanya jika saldo nol, kecuali admin override dengan alasan tercatat. |
| ACTIVE | REMOVED | Dikeluarkan admin. Syarat saldo sama dengan LEFT. OWNER tidak dapat dikeluarkan. |
| LEFT atau REMOVED | ACTIVE | Bergabung kembali lewat kode. Baris yang sama dipakai. |

OWNER tidak dapat LEFT sebelum menyerahkan kepemilikan. Pemegang dana tidak dapat LEFT sebelum menyerahkan dana (K10). Mantan anggota yang masih punya utang atau piutang tetap tampil di ledger sebagai mantan anggota (keputusan 7).

<!-- akhir-bagian-7a -->

### 7.4 Matriks hak akses

Otorisasi ditegakkan di service, bukan di klien (prinsip 5). Setiap rute memeriksa keanggotaan ACTIVE lebih dulu, lalu aksi di bawah ini. Penalang adalah payerId transaksi. Pemegang dana adalah GroupFund.holderId. Keduanya atribut, bukan peran.

| Aksi | OWNER | ADMIN | MEMBER | Catatan |
|---|---|---|---|---|
| Melihat grup, anggota, riwayat transaksi | ya | ya | ya | Hanya anggota ACTIVE. Non-anggota mendapat 403. |
| Melihat kode grup | ya | ya | bila tidak disembunyikan | Bergantung Group.codeHidden. |
| Mengubah pengaturan grup (kode tersembunyi, persetujuan gabung, sederhanakan, metode pembayaran grup) | ya | ya | tidak | |
| Menyetujui atau menolak anggota PENDING, menambah anggota via email terdaftar | ya | ya | tidak | |
| Mengeluarkan anggota | ya | hanya MEMBER | tidak | Syarat saldo nol atau override. K12. |
| Mengangkat atau menurunkan admin, memindahkan kepemilikan | ya | tidak | tidak | Keputusan 1. |
| Keluar sendiri | setelah serah terima | ya | ya | Syarat saldo nol atau override. |
| Override keluar atau dikeluarkan dengan saldo tidak nol | ya | ya | tidak | Alasan wajib, AuditLog OVERRIDE_LEAVE. OWNER tidak dapat dikeluarkan. |
| Membuat transaksi | ya | ya | ya | payerId diambil dari token, tidak bisa atas nama orang lain. |
| Upload struk dan verifikasi AI | penalang | penalang | penalang | Hanya penalang transaksi itu. |
| Memberi suara pada Approval | sesuai rule | sesuai rule | sesuai rule | ADMIN_ANY dan ADMIN_OTHER hanya admin. MAJORITY dan QUORUM_20 semua anggota aktif. FUND_HOLDER hanya pemegang. Pengaju tidak boleh memilih miliknya. |
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

- Hanya penalang pada pelunasan itu yang melihat nama pemegang. Anggota lain tidak.
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
