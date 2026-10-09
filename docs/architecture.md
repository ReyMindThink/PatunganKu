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
| Transaction | id, groupId, payerId (penalang), description, amount, mode (EQUAL_ALL, EQUAL_SUBSET, ITEMIZED), status (PENDING_APPROVAL, ACTIVE, REJECTED, EXPIRED, TAKEN_DOWN), receiptUrl, receiptStatus (PENDING, VERIFIED, FAILED, NEEDS_REVIEW), imageSha256, fingerprint, paidFromFund, version, createdAt. Indeks (groupId, imageSha256) dan (groupId, fingerprint). |
| TransactionSplit | Dihapus, diganti TransactionShare. |
| TransactionShare | id, transactionId, userId, amount, consent (PENDING, ACCEPTED, REJECTED), consentAt. Unik (transactionId, userId). Ini tabel kerja (alur persetujuan), bukan ledger. |
| PaymentConfirmation | id, groupId, senderId, receiverId, amount, methodType (BANK, EWALLET, CASH), proofUrl, status (PENDING, CONFIRMED, REJECTED, CANCELLED), createdAt, decidedAt, cancelledAt. Bukti wajib kecuali CASH (divalidasi di service). Saat CONFIRMED menulis satu entri SETTLEMENT di ledger. |

Batas nominal per transaksi: MAX_TRANSACTION_AMOUNT di constants.js, ditegakkan di zod dan di CHECK database (nilai menunggu konfirmasi).

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
