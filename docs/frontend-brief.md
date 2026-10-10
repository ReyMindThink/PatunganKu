# Panduan integrasi frontend PatunganKu

Peta singkat dari kontrak API untuk pengembang frontend. Bentuk request dan response lengkap ada di docs/api-contract.md. Aturan bisnis, status, dan alasan desain ada di docs/architecture.md. Bila dokumen ini berbeda dari keduanya, keduanya yang benar, dan perbedaan itu dilaporkan sebagai kesalahan dokumen ini.

## 1. Cara memakai dokumen ini

- Status: rancangan Tahap 0. Backend yang berjalan sekarang hanya endpoint lama (auth, grup, transaksi, saldo, pelunasan, struk) dengan bentuk respons lama. Semua yang ada di kontrak adalah rancangan yang akan menggantikannya. Bangun frontend dengan lapisan mock yang mengikuti kontrak, bukan bentuk lama.
- Nama layar di bagian 3 diturunkan dari spesifikasi produk, bukan dari desain Hi-Fi. Cocokkan dengan layar yang sebenarnya, dan laporkan layar yang tidak punya padanan atau yang butuh data yang tidak ada di objek kontrak.
- Tahap backend menunjukkan kapan endpoint tersedia. Pembagian ini dari rencana kerja dan dapat bergeser.

| Tahap | Isi untuk frontend |
|---|---|
| 1 | Transaksi (DRAFT, struk, submit), persetujuan dan consent, notifikasi, saldo, pelunasan dan bukti, metode pembayaran, riwayat |
| 2 | Pilih item real-time, revisi dan takedown, peran dan keluar-masuk anggota (undangan, permintaan gabung), refresh token, pemulihan kata sandi |
| 3 | Chat, dana kelompok, pengingat utang, ganti email |
| 4 | Hapus akun, pengerasan keamanan |
| 5 | Chatbot |

## 2. Aturan wajib klien

1. Semua rute berawalan /api. Body JSON UTF-8. Header Authorization: Bearer diisi dengan accessToken, kecuali endpoint daftar, masuk, refresh, logout, lupa kata sandi, reset, dan konfirmasi email.
2. Respons sukses selalu { data } (daftar yang bisa panjang ditambah page). Error berformat application/problem+json: logika klien memakai field code, teks untuk pengguna memakai detail. Bentuk lama { error, message } tidak dipakai. Validasi gagal (validation-failed) memuat errors berisi { field, message }.
3. Uang adalah bilangan bulat rupiah. Format titik ribuan di klien. Jangan memakai bilangan pecahan, dan jangan menjumlahkan sendiri untuk menentukan saldo, karena angka saldo selalu dari server.
4. Waktu berformat ISO 8601 UTC. Tampilkan dalam WIB (Asia/Jakarta). Pengelompokan bulan dilakukan server lewat query month=YYYY-MM.
5. Id adalah nilai buram. Jangan melakukan aritmetika padanya.
6. Idempotency-Key: kirim UUID v4 di setiap endpoint tulis selain endpoint auth. Satu niat aksi memakai satu kunci, dan percobaan ulang (jaringan putus, dobel tap) memakai kunci yang sama. Niat baru memakai kunci baru. Endpoint yang tidak membutuhkannya mengabaikannya.
7. Hanya 401 dengan code unauthorized yang memicu refresh token. Kode invalid-credentials, invalid-refresh-token, dan refresh-reuse tidak memicu refresh, dan klien menampilkan layar login. Baca refreshMode dari respons: NONE (tidak ada refresh), BODY (simpan dan kirim refreshToken di body), atau COOKIE (tanpa body, fetch memakai credentials include, dan wajib membawa header X-Requested-With bernilai patunganku). Refresh bersifat single-flight, termasuk antar tab, dengan navigator.locks bila tersedia. Bila menerima 409 refresh-conflict, tunggu sekitar 300 milidetik, baca ulang token tersimpan, lalu ulangi sekali (api-contract 14.7).
8. Teks dari pengguna dan dari struk adalah data tak tepercaya, dan dirender sebagai teks biasa tanpa HTML: nama pengguna, nama grup, deskripsi transaksi, nama item hasil OCR, isi chat, alasan revisi, dan keterangan sumber dana. Jangan memakai dangerouslySetInnerHTML.
9. Tombol dan izin mengikuti flag dari server, bukan diturunkan dari peran: canVote, myVote, canClaim, canOffer, canFinalize, canManage, canMark, canSend, dan payable. Server juga menyamarkan data. Bila suatu field bernilai null, tampilkan keadaan tanpa data itu, jangan menebak: holder dan pendingHolder pada dana, participants pada transaksi, code pada grup, contributor pada riwayat dana, dan sender pada kartu sistem.
10. Gambar (struk, bukti pelunasan, gambar chat) tidak dapat dimuat lewat atribut src karena membutuhkan header Authorization. Ambil dengan fetch berheader, ubah menjadi blob URL, lalu lepaskan blob URL saat tidak dipakai.
11. Pagination memakai kursor: { data, page: { nextCursor, hasMore } }. Chat memakai pagination dua arah (before dan after) dengan page berisi hasMoreBefore dan hasMoreAfter. Daftar yang selalu kecil tidak memakai page.
12. Socket.IO: sambung dengan opsi auth { token }. Klien tidak memilih room. Event hanya memberi tahu ada perubahan, jadi ambil ulang datanya lewat REST. Pengecualiannya message:created, yang membawa objek pesan lengkap dan dibuang duplikatnya berdasarkan id pesan. Event tidak diulang setelah koneksi putus, jadi setelah tersambung kembali ambil ulang data yang tampil. Putus dengan alasan token-expired berarti refresh token lalu sambung ulang.
13. Pelaku, penalang, dan pembayar tidak pernah dikirim dari klien. Server mengambilnya dari token.
14. Respons 429 rate-limited membawa header Retry-After (detik). Tampilkan waktu tunggu.
15. Klien mengabaikan field, type, kind, action, dan nilai enum yang tidak dikenal, supaya penambahan di backend tidak merusak klien lama.
16. Anggota berstatus LEFT atau REMOVED tampil sebagai mantan anggota. Mantan anggota hanya melihat bagian ledger miliknya, dan objek grupnya terbatas.
17. Tautan reset kata sandi dan konfirmasi ganti email membawa token di fragmen URL (setelah tanda #). Baca token, hapus fragmen dengan history.replaceState sebelum permintaan jaringan apa pun, dan jangan mencatatnya.
18. Pesan dan gambar chat permanen. Minta konfirmasi sebelum mengirim gambar. Sebelum mengunggah gambar, gambar ulang ke canvas untuk membuang metadata lokasi dan mengecilkan ukuran.

<!-- akhir-bagian-brief-1 -->

## 3. Peta layar ke endpoint

Awalan /api dihilangkan pada tabel. Singkatan G adalah /groups/:groupId. Bentuk lengkap tiap endpoint ada di bagian kontrak yang disebutkan.

### 3.1 Akun dan sesi (api-contract 14)

| Layar atau aksi | Endpoint | Catatan |
|---|---|---|
| Daftar | POST /auth/register | Body email, password, name. Tidak ada phone. |
| Masuk | POST /auth/login | Respons berisi user, accessToken, refreshToken, refreshMode, expiresIn. |
| Profil saya | GET /me, PATCH /me | Hanya name yang dapat diubah di sini. |
| Refresh dan keluar | POST /auth/refresh, POST /auth/logout | Tahap 2. Aturan klien di bagian 2 butir 7. |
| Lupa kata sandi | POST /auth/password/forgot | Selalu 202. Tahap 2. |
| Halaman reset (rute frontend /reset-password, token di fragmen) | POST /auth/password/reset | 204. Arahkan ke layar masuk setelahnya. |
| Ganti kata sandi | POST /me/password | Respons berisi pasangan token baru untuk perangkat ini. |
| Ganti email | POST /me/email/change | Tahap 3. Token dikirim ke alamat baru. |
| Halaman konfirmasi email (rute frontend /confirm-email, token di fragmen) | POST /auth/email/confirm | 204. Semua perangkat harus masuk ulang. |
| Hapus akun | POST /me/deletion | Tahap 4. Bila 409 delete-blocked, tampilkan blockers. |
| Pengaturan email notifikasi | GET dan PATCH /me/notification-settings | Berisi notifyByEmail. |

Dua halaman terakhir yang berasal dari tautan email adalah rute frontend yang harus ada. Alamat dasarnya diatur backend lewat APP_BASE_URL.

### 3.2 Beranda dan grup (api-contract 11.1 sampai 11.3, 6.5, 13.5)

| Layar atau aksi | Endpoint | Catatan |
|---|---|---|
| Daftar grup saya | GET /groups | Berisi membership, myRole, memberCount, balance, pendingJoinRequests. Grup LEFT atau REMOVED hanya muncul bila saldo tidak nol. |
| Lencana beranda | GET /me/summary, GET /notifications/unread-count, GET /me/chat-unread | Seluruhnya lintas grup. |
| Buat grup | POST /groups | Body name. Pembuat menjadi OWNER (tampil sebagai Admin). |
| Gabung dengan kode | POST /groups/join | Kirim kode dalam huruf besar tanpa spasi. Hasil outcome JOINED (200) atau REQUESTED (202, menunggu admin). |
| Permintaan gabung saya | GET /me/join-requests, POST /me/join-requests/:requestId/cancel | |
| Undangan untuk saya | GET /me/invitations, POST /me/invitations/:invitationId/accept, POST .../decline | |
| Detail grup | GET /G | code bernilai null bagi anggota biasa bila disembunyikan admin. |

Event: group:updated dan member:updated (room grup), notification:created (room pribadi).

### 3.3 Anggota dan pengaturan grup (api-contract 11.2 sampai 11.6, 10.3)

| Layar atau aksi | Endpoint | Catatan |
|---|---|---|
| Daftar anggota | GET /G/members | Tanpa email, dan tanpa penanda pemegang dana. |
| Ubah peran | PUT /G/members/:userId/role | Hanya OWNER. Peran ADMIN atau MEMBER. |
| Serah terima kepemilikan | POST /G/ownership/transfer | Hanya OWNER, ke ADMIN. |
| Keluar | POST /G/leave | Bila 409 leave-blocked, tampilkan blockers. |
| Keluarkan anggota | POST /G/members/:userId/remove | Body reason dan overrideBalance. Admin hanya dapat mengeluarkan MEMBER. |
| Pengaturan grup | PATCH /G | name, codeHidden, joinRequiresApproval. |
| Putar kode | POST /G/code/rotate | Kode lama langsung tidak berlaku. |
| Permintaan gabung (admin) | GET /G/join-requests, POST .../:requestId/approve, POST .../:requestId/reject | |
| Undangan (admin) | POST /G/invitations, GET /G/invitations, DELETE /G/invitations/:invitationId | POST selalu 202. Email pada daftar disamarkan. |
| Metode pembayaran yang diterima grup | GET dan PUT /G/payment-settings | PUT hanya admin. |

Event: member:updated dan group:updated. Notifikasi: JOIN_REQUEST, GROUP_INVITE, MEMBERSHIP_CHANGED.

### 3.4 Transaksi (api-contract 9)

| Layar atau aksi | Endpoint | Catatan |
|---|---|---|
| Buat transaksi | POST /G/transactions | Menghasilkan status DRAFT, hanya terlihat oleh pembuatnya. Mode EQUAL_ALL, EQUAL_SUBSET, CUSTOM, ITEMIZED. |
| Ubah atau hapus DRAFT | PATCH dan DELETE /G/transactions/:transactionId | Mengubah nominal membatalkan verifikasi struk. |
| Unggah struk | POST /G/transactions/:transactionId/receipt | multipart, field bernama receipt, maksimal 5 MB. |
| Verifikasi struk | POST .../receipt/verify | decision.reason menjelaskan hasilnya. 409 duplicate-receipt memuat existingTransactionId. |
| Hasil baca struk | GET .../extraction | Bentuk belum final (bagian 5). |
| Kirim transaksi | POST .../submit | Hasilnya ACTIVE atau PENDING_APPROVAL, dengan approval bila ada. |
| Daftar per bulan | GET /G/transactions | Query month, status, mode, payerId, limit, cursor. |
| Detail | GET /G/transactions/:transactionId | participants dan myShare bergantung hak lihat. |
| Ajukan revisi | POST .../revisions, GET .../revisions | Wajib baseVersion dan reason. 409 version-conflict berarti ambil ulang. |
| Tarik pengajuan | POST .../withdraw | Hanya penalang, hanya selama PENDING_APPROVAL. |
| Takedown | POST .../takedown | Hanya admin. Body reason dan baseVersion. |
| Riwayat pribadi lintas grup | GET /me/history | Query month, groupId, counterpartyId. |

Event: transaction:updated (room grup). Status akhir REJECTED, EXPIRED, WITHDRAWN, dan TAKEN_DOWN tetap tampil di riwayat.

### 3.5 Persetujuan dan consent (api-contract 6.3, 6.4)

| Layar atau aksi | Endpoint | Catatan |
|---|---|---|
| Daftar persetujuan | GET /G/approvals | Query status=OPEN dan mine=true. |
| Detail persetujuan | GET /G/approvals/:approvalId | canVote dan myVote dari server. |
| Beri suara | POST /G/approvals/:approvalId/votes | Body vote APPROVE atau REJECT. Aturan penentu tunggal langsung memutuskan. |
| Consent peserta | POST /G/transactions/:transactionId/shares/me/consent | Body decision ACCEPT atau REJECT. Respons memuat status transaksi terbaru. |

Event: approval:updated, transaction:updated, notification:created. Event share:updated hanya diterima penalang dan peserta yang bersangkutan.

Permintaan consent tidak pernah menjadi kartu di chat. Peserta hanya menerimanya lewat notifikasi CONSENT_REQUEST. Alasannya, chat dibaca semua anggota dan akan mengumumkan siapa yang menolak.

### 3.6 Pilih item, mode ITEMIZED (api-contract 7)

| Layar atau aksi | Endpoint | Catatan |
|---|---|---|
| Kartu pilih item | GET /G/transactions/:transactionId/items | phase CLAIMING atau FINALIZED. Ongkir bernilai null sampai FINALIZED. |
| Pilih atau ubah pilihan | PUT /G/transactions/:transactionId/claims/me | Mengganti seluruh pilihan saya. Gagal 409 item-unavailable bila unit habis. |
| Done | POST /G/transactions/:transactionId/claims/me/done | Mengubah semua pilihan saya menjadi tanggungan. |
| Tunjuk anggota untuk item sisa (penalang) | POST /G/transactions/:transactionId/items/:itemId/assignments | Kapan saja selama unit tersisa. |
| Jawab penunjukan | POST /G/assignments/:assignmentId/respond | Body decision ACCEPT atau REJECT. |
| Batalkan penunjukan | POST /G/assignments/:assignmentId/cancel | Penalang atau admin. |
| Tutup pembagian (penalang) | POST /G/transactions/:transactionId/finalize | Kapan saja. Tidak dapat dibuka kembali. |

Event: item:updated (itemId, claimedQty, remainingQty) dan items:phase. Perbarui angka dari muatan event. Ambil ulang kartu bila angka tidak cocok, atau bila terjadi 409 item-unavailable.

Catatan perilaku:
- Pilihan yang belum Done dilepas otomatis setelah 12 jam, dengan pengingat pada jam ke-10 lewat notifikasi HOLD_EXPIRING.
- Klaim yang sudah Done dapat terkunci setelah pelunasan terkonfirmasi (409 claim-locked).
- Kartu ini juga muncul di chat sebagai pesan SYSTEM_CARD bertipe ITEM_PICK. Datanya selalu dibaca dari endpoint di atas.

<!-- akhir-bagian-brief-2 -->

### 3.7 Chat (api-contract 13)

| Layar atau aksi | Endpoint | Catatan |
|---|---|---|
| Kirim teks | POST /G/messages | Body body, maksimal 2000 karakter. |
| Kirim gambar | POST /G/messages/images | multipart, field image dan body (keterangan, opsional). JPEG, PNG, atau WebP, maksimal 5 MB. |
| Baca pesan | GET /G/messages | Query limit, before, after. Hasil menaik menurut id. |
| Tampilkan gambar | GET /G/messages/:messageId/image | fetch berheader lalu blob URL. |
| Tandai dibaca | POST /G/messages/read | Body messageId. |
| Jumlah belum dibaca | GET /me/chat-unread | Per grup. |

Event: message:created dengan muatan { groupId, message }. Buang duplikat berdasarkan id pesan, karena event dapat tiba sebelum atau sesudah respons POST.

Catatan perilaku:
- Pesan hanya teks, gambar, dan kartu sistem. Tidak ada edit, hapus, balasan, mention, stiker, atau status dibaca untuk orang lain. Emoji adalah karakter Unicode di dalam teks.
- Kartu sistem bertipe ITEM_PICK (card.transactionId) atau APPROVAL (card.approvalId dan card.transactionId). Datanya dibaca dari endpoint 3.6 dan 3.5.
- Anggota hanya melihat pesan sejak ia menjadi anggota aktif. Anggota yang keluar lalu bergabung kembali tidak melihat pesan periode sebelumnya.
- Mantan anggota tidak punya akses chat.
- Susul pesan yang terlewat setelah koneksi pulih dengan after berisi id terbesar yang sudah diterima.

### 3.8 Saldo dan pelunasan (api-contract 10)

| Layar atau aksi | Endpoint | Catatan |
|---|---|---|
| Ringkasan utang per anggota | GET /G/balances | Setiap anggota: owes, owed, balance. Jumlah semua balance adalah nol. |
| Rincian per kreditur (profil, gulir ke bawah) | GET /G/balances/:userId | counterparties: amount, direction, breakdown (group, individual, settled), pendingPayments, payable. |
| Ringkasan lintas grup | GET /me/balances | |
| Metode pembayaran saya | GET dan POST /me/payment-methods, PATCH dan DELETE /me/payment-methods/:methodId | Kind BANK, EWALLET, atau CASH. Minimal satu metode aktif. |
| Metode pihak lain | GET /G/members/:userId/payment-methods | 403 bila bukan pihak yang bertransaksi. |
| Kirim pelunasan | POST /G/payments | multipart: receiverId, amount, methodType, methodId, note, proof. Bukti wajib kecuali CASH. |
| Daftar dan detail pelunasan | GET /G/payments, GET /G/payments/:paymentId | Query role (sent atau received) dan status. |
| Konfirmasi, tolak, batalkan | POST /G/payments/:paymentId/confirm, .../reject, .../cancel | Penerima untuk dua yang pertama, pengirim untuk yang ketiga. |
| Bukti pelunasan | GET /G/payments/:paymentId/proof | fetch berheader lalu blob URL. |
| Pengingat utang | POST /G/reminders, GET /G/reminders/status | Gunakan canSend, remaining, dan nextAllowedAt untuk tombol. |

Event: balances:changed (room grup, lalu ambil ulang saldo) dan payment:updated (hanya pengirim dan penerima).

Catatan perilaku:
- Angka utama adalah saldo bersih per pasangan: yang A tanggung ke B dikurangi yang B tanggung ke A. Rincian asli per kreditur tetap tersedia lewat breakdown.
- Tidak ada rekomendasi pelunasan multilateral. Pelunasan hanya antara dua pihak yang berutang langsung, dan nominalnya dibatasi payable.
- Nomor rekening tampil hanya bila pemanggil pemilik, atau berutang kepada pemilik.

### 3.9 Dana kelompok (api-contract 12)

| Layar atau aksi | Endpoint | Catatan |
|---|---|---|
| Info dana | GET /G/fund | data bernilai null bila grup belum punya dana. |
| Buat dana (admin) | POST /G/fund | Menunjuk calon pemegang. Dana berstatus PENDING sampai calon menerima. |
| Penunjukan pemegang | POST /G/fund/holder/nominate, DELETE .../nominate, POST .../accept, POST .../decline | |
| Tambah dana (pemegang) | POST /G/fund/topups | Body contributorId, amount, source. |
| Pergerakan dana | GET /G/fund/entries | |
| Tandai transaksi dibayar dana (pemegang) | POST /G/transactions/:transactionId/fund-payment | Body baseVersion dan acceptPartial. 409 fund-insufficient memuat balance dan remainder. |
| Tutup dana (pemegang) | POST /G/fund/close | Ditolak bila masih ada yang berutang kepada Dana. |

Event: fund:updated. Notifikasi: FUND_HOLDER_OFFER, FUND_TOPUP, FUND_HOLDER_CHANGED.

Catatan perilaku:
- Dana tampil sebagai Dana Kelompok. holder dan pendingHolder hanya terisi bagi admin dan pemegang, dan contributor hanya bagi admin, pemegang, dan orang itu sendiri. Anggota lain tetap menerima field dengan nilai null.
- Dana hanya untuk transaksi EQUAL_ALL.
- Pelunasan atas nama dana memakai onBehalfOfFund atau toFund pada POST /G/payments.

### 3.10 Notifikasi dan riwayat (api-contract 6.2, 8)

| Layar atau aksi | Endpoint | Catatan |
|---|---|---|
| Kotak masuk | GET /notifications | Lintas grup, berkursor. Query unread=true dan groupId. |
| Lencana | GET /notifications/unread-count | |
| Tandai dibaca | POST /notifications/:notificationId/read, POST /notifications/read-all | 204, aman diulang. |
| Riwayat pergerakan grup | GET /G/audit | Query entity, action, actorId, transactionId, from, to. Berkursor. |

Event: notification:created (room pribadi), lalu perbarui lencana atau ambil ulang daftar.

Ada 17 jenis notifikasi: APPROVAL_REQUEST, APPROVAL_DECIDED, CONSENT_REQUEST, REVISION_NOTICE, ITEM_UNCLAIMED, ITEM_OFFERED, HOLD_EXPIRING, ITEMS_CLOSED, PAYMENT_REQUEST, PAYMENT_DECIDED, REMINDER, JOIN_REQUEST, GROUP_INVITE, MEMBERSHIP_CHANGED, FUND_HOLDER_OFFER, FUND_TOPUP, dan FUND_HOLDER_CHANGED. Muatan tiap notifikasi memuat id yang dibutuhkan untuk membuka layar tujuan. Jenis yang tidak dikenal ditampilkan umum dan tidak membuat aplikasi gagal.

## 4. Angka yang tampil di UI

Sebagian adalah usulan dan dapat berubah. Konstanta resmi ada di architecture.md bagian 4.

| Hal | Nilai |
|---|---|
| Password | 8 sampai 72 byte UTF-8 (bukan karakter) |
| Nama | 1 sampai 100 karakter |
| Email | Maksimal 254 karakter |
| Kode grup | 6 karakter huruf A sampai Z tanpa I dan O, dan angka 2 sampai 9 |
| Batas anggota per grup | 50 (usulan) |
| Nominal maksimal per transaksi | Rp100.000.000 |
| Pesan chat | Maksimal 2000 karakter Unicode |
| Gambar (struk, bukti, chat) | JPEG, PNG, atau WebP, maksimal 5 MB |
| Batas kirim chat | 20 pesan teks per menit dan 5 gambar per 5 menit per grup (usulan) |
| Pilihan item belum Done dilepas | 12 jam, pengingat pada jam ke-10 |
| Notifikasi item belum terpilih | 24 jam setelah kartu terbit |
| Kedaluwarsa persetujuan, permintaan gabung, undangan, penunjukan | 7 hari |
| Pengingat utang | Jeda 12 jam, maksimal 3 kali per siklus utang |
| Jeda mengajukan gabung lagi | 24 jam |
| Masa akses token | 1 jam sekarang, 15 menit setelah refresh token tersedia |
| Masa refresh token | 30 hari sejak login |
| Token reset kata sandi | 1 jam |
| Token ganti email | 24 jam (usulan) |

## 5. Belum tersedia atau belum final

- Bentuk hasil baca struk (GET .../extraction): menunggu kontrak AI dengan AI Engineer. Jangan memfinalkan layar hasil baca struk.
- Revisi yang mengubah item pada transaksi ITEMIZED, dan efeknya pada klaim yang sudah Done, belum ditulis.
- Chatbot: Tahap 5, belum ada kontrak.
- Layanan pengiriman email produksi belum ada. Alur lupa kata sandi dan ganti email hanya berjalan lokal sampai itu diputuskan.
- Domain penyebaran frontend dan API belum diketahui. Itu menentukan apakah refresh token memakai mode BODY atau COOKIE (api-contract 14.7), jadi klien harus mendukung keduanya.
- Semua endpoint di bagian 3 selain endpoint lama belum diimplementasi. Jangan memanggil backend sungguhan untuk endpoint baru sampai tahapnya selesai.

## 6. Urutan yang disarankan

1. Satu modul klien API: header, Idempotency-Key, penguraian problem+json, refresh single-flight, dan antrean ulang.
2. Tipe TypeScript yang mengikuti kontrak (nama dan nilai status persis sama).
3. Lapisan mock yang mengembalikan bentuk kontrak, sehingga layar dapat dibangun sebelum backend siap.
4. Akun dan sesi, lalu beranda dan grup, lalu transaksi dan saldo.
5. Pelunasan, lalu persetujuan dan notifikasi.
6. Pilih item real-time (paling berat di UI), lalu chat, lalu dana kelompok.
7. Pengaturan akun lanjutan (ganti kata sandi, ganti email, hapus akun).

## 7. Pertanyaan untuk Aqidatul

1. Apakah kode frontend sudah berlanjut dari tiga halaman yang ada (auth, beranda, buat dan gabung grup)? Bila ya, apa yang sudah berubah?
2. Layar Hi-Fi mana yang sudah final? Terutama kartu pilih item di chat, chat, notifikasi, dan rincian utang di halaman profil.
3. Adakah layar atau aksi yang tidak punya padanan di bagian 3, atau layar yang butuh data yang tidak ada di objek kontrak?
4. Perkiraan domain penyebaran: frontend dan API satu situs atau lintas situs? Jawabannya menentukan mode refresh token.
5. Apakah dokumen ini cukup untuk mulai membangun dengan mock, atau ada bagian kontrak yang perlu diperjelas?

<!-- akhir-bagian-brief -->
