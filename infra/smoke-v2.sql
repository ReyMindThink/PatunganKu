-- smoke-v2.sql: uji asap perilaku skema patunganku_v2 (Tahap 1, T1.1)
-- Jalankan SEKALI per database dengan sqlcmd opsi -I. Data uji menetap (email @smoke.test).
-- Penanda: BENAR (ditolak sesuai harapan), OK (diterima sesuai harapan), CELAH, INFO, MASALAH.
SET NOCOUNT ON;
SET ARITHABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
SET QUOTED_IDENTIFIER ON;
GO
IF EXISTS (SELECT 1 FROM [dbo].[User] WHERE [email] = N'u1@smoke.test')
BEGIN
    PRINT N'MASALAH: skrip ini sudah pernah dijalankan pada database ini';
    SET NOEXEC ON;
END
GO
CREATE TABLE #ids ([k] NVARCHAR(20) NOT NULL PRIMARY KEY, [v] INT NOT NULL);
GO
-- Fixture: pengguna
INSERT INTO [dbo].[User] ([email], [passwordHash], [name]) VALUES (N'u1@smoke.test', N'x', N'U1'), (N'u2@smoke.test', N'x', N'U2'), (N'u3@smoke.test', N'x', N'U3');
INSERT INTO #ids SELECT N'u1', [id] FROM [dbo].[User] WHERE [email] = N'u1@smoke.test';
INSERT INTO #ids SELECT N'u2', [id] FROM [dbo].[User] WHERE [email] = N'u2@smoke.test';
INSERT INTO #ids SELECT N'u3', [id] FROM [dbo].[User] WHERE [email] = N'u3@smoke.test';
GO
-- Fixture: dua grup
DECLARE @u1 INT = (SELECT [v] FROM #ids WHERE [k] = N'u1');
INSERT INTO [dbo].[Group] ([name], [code], [createdBy]) VALUES (N'Smoke 1', N'SMK001', @u1);
INSERT INTO #ids VALUES (N'g1', SCOPE_IDENTITY());
INSERT INTO [dbo].[Group] ([name], [code], [createdBy]) VALUES (N'Smoke 2', N'SMK002', @u1);
INSERT INTO #ids VALUES (N'g2', SCOPE_IDENTITY());
GO
-- Fixture: anggota g1, dua transaksi, dua ekstraksi, satu baris audit
DECLARE @g1 INT = (SELECT [v] FROM #ids WHERE [k] = N'g1'), @u1 INT = (SELECT [v] FROM #ids WHERE [k] = N'u1'), @u2 INT = (SELECT [v] FROM #ids WHERE [k] = N'u2'), @u3 INT = (SELECT [v] FROM #ids WHERE [k] = N'u3');
INSERT INTO [dbo].[GroupMember] ([groupId], [userId], [role]) VALUES (@g1, @u1, N'OWNER'), (@g1, @u2, N'MEMBER'), (@g1, @u3, N'MEMBER');
INSERT INTO [dbo].[Transaction] ([groupId], [payerId], [description], [amount], [status]) VALUES (@g1, @u1, N'smoke aktif', 70000, N'ACTIVE');
INSERT INTO #ids VALUES (N't1', SCOPE_IDENTITY());
INSERT INTO [dbo].[Transaction] ([groupId], [payerId], [description], [amount], [status]) VALUES (@g1, @u1, N'smoke draft', 50000, N'DRAFT');
INSERT INTO #ids VALUES (N't2', SCOPE_IDENTITY());
DECLARE @t1 INT = (SELECT [v] FROM #ids WHERE [k] = N't1'), @t2 INT = (SELECT [v] FROM #ids WHERE [k] = N't2');
INSERT INTO [dbo].[ReceiptExtraction] ([transactionId], [version], [source]) VALUES (@t1, 1, N'AI');
INSERT INTO #ids VALUES (N'e1', SCOPE_IDENTITY());
INSERT INTO [dbo].[ReceiptExtraction] ([transactionId], [version], [source]) VALUES (@t2, 1, N'AI');
INSERT INTO #ids VALUES (N'e2', SCOPE_IDENTITY());
INSERT INTO [dbo].[AuditLog] ([groupId], [actorId], [entity], [action], [newValue]) VALUES (@g1, @u1, N'Smoke', N'TEST', N'{"a":1}');
INSERT INTO #ids VALUES (N'a1', SCOPE_IDENTITY());
GO
-- A01: batas atas nominal transaksi
DECLARE @g1 INT = (SELECT [v] FROM #ids WHERE [k] = N'g1'), @u1 INT = (SELECT [v] FROM #ids WHERE [k] = N'u1');
BEGIN TRY
    INSERT INTO [dbo].[Transaction] ([groupId], [payerId], [description], [amount]) VALUES (@g1, @u1, N'batas atas', 100000000);
    PRINT N'OK: A01 transaksi tepat Rp100.000.000 diterima';
END TRY
BEGIN CATCH
    PRINT N'MASALAH: A01 ' + CAST(ERROR_NUMBER() AS NVARCHAR(10)) + N' ' + LEFT(ERROR_MESSAGE(), 160);
END CATCH
GO
-- A02: CHARGE sah
DECLARE @g1 INT = (SELECT [v] FROM #ids WHERE [k] = N'g1'), @u1 INT = (SELECT [v] FROM #ids WHERE [k] = N'u1'), @u2 INT = (SELECT [v] FROM #ids WHERE [k] = N'u2'), @t1 INT = (SELECT [v] FROM #ids WHERE [k] = N't1');
BEGIN TRY
    INSERT INTO [dbo].[LedgerEntry] ([groupId], [type], [sign], [amount], [debtorUserId], [creditorUserId], [category], [transactionId], [createdBy]) VALUES (@g1, N'CHARGE', 1, 23333, @u2, @u1, N'GROUP', @t1, @u1);
    INSERT INTO #ids VALUES (N'c1', SCOPE_IDENTITY());
    PRINT N'OK: A02 CHARGE sah diterima';
END TRY
BEGIN CATCH
    PRINT N'MASALAH: A02 ' + CAST(ERROR_NUMBER() AS NVARCHAR(10)) + N' ' + LEFT(ERROR_MESSAGE(), 160);
END CATCH
GO
-- A03: REVERSAL sah pertama atas c1
DECLARE @g1 INT = (SELECT [v] FROM #ids WHERE [k] = N'g1'), @u1 INT = (SELECT [v] FROM #ids WHERE [k] = N'u1'), @u2 INT = (SELECT [v] FROM #ids WHERE [k] = N'u2'), @t1 INT = (SELECT [v] FROM #ids WHERE [k] = N't1'), @c1 INT = (SELECT [v] FROM #ids WHERE [k] = N'c1');
BEGIN TRY
    INSERT INTO [dbo].[LedgerEntry] ([groupId], [type], [sign], [amount], [debtorUserId], [creditorUserId], [category], [transactionId], [reversesEntryId], [createdBy]) VALUES (@g1, N'REVERSAL', -1, 23333, @u2, @u1, N'GROUP', @t1, @c1, @u1);
    INSERT INTO #ids VALUES (N'r1', SCOPE_IDENTITY());
    PRINT N'OK: A03 REVERSAL sah pertama diterima';
END TRY
BEGIN CATCH
    PRINT N'MASALAH: A03 ' + CAST(ERROR_NUMBER() AS NVARCHAR(10)) + N' ' + LEFT(ERROR_MESSAGE(), 160);
END CATCH
GO
-- A04: pelunasan tunai tanpa bukti
DECLARE @g1 INT = (SELECT [v] FROM #ids WHERE [k] = N'g1'), @u1 INT = (SELECT [v] FROM #ids WHERE [k] = N'u1'), @u2 INT = (SELECT [v] FROM #ids WHERE [k] = N'u2');
BEGIN TRY
    INSERT INTO [dbo].[PaymentConfirmation] ([groupId], [senderId], [receiverId], [amount], [methodType]) VALUES (@g1, @u2, @u1, 23333, N'CASH');
    INSERT INTO #ids VALUES (N'p1', SCOPE_IDENTITY());
    PRINT N'OK: A04 pelunasan tunai tanpa bukti diterima';
END TRY
BEGIN CATCH
    PRINT N'MASALAH: A04 ' + CAST(ERROR_NUMBER() AS NVARCHAR(10)) + N' ' + LEFT(ERROR_MESSAGE(), 160);
END CATCH
GO
-- A05: SETTLEMENT sah
DECLARE @g1 INT = (SELECT [v] FROM #ids WHERE [k] = N'g1'), @u1 INT = (SELECT [v] FROM #ids WHERE [k] = N'u1'), @u2 INT = (SELECT [v] FROM #ids WHERE [k] = N'u2'), @p1 INT = (SELECT [v] FROM #ids WHERE [k] = N'p1');
BEGIN TRY
    INSERT INTO [dbo].[LedgerEntry] ([groupId], [type], [sign], [amount], [debtorUserId], [creditorUserId], [paymentId], [createdBy]) VALUES (@g1, N'SETTLEMENT', -1, 100, @u2, @u1, @p1, @u1);
    INSERT INTO #ids VALUES (N's1', SCOPE_IDENTITY());
    PRINT N'OK: A05 SETTLEMENT sah diterima';
END TRY
BEGIN CATCH
    PRINT N'MASALAH: A05 ' + CAST(ERROR_NUMBER() AS NVARCHAR(10)) + N' ' + LEFT(ERROR_MESSAGE(), 160);
END CATCH
GO
-- A06: DELETE ekstraksi saat transaksi DRAFT
DECLARE @e2 INT = (SELECT [v] FROM #ids WHERE [k] = N'e2');
BEGIN TRY
    DELETE FROM [dbo].[ReceiptExtraction] WHERE [id] = @e2;
    IF EXISTS (SELECT 1 FROM [dbo].[ReceiptExtraction] WHERE [id] = @e2)
    BEGIN
        PRINT N'MASALAH: A06 baris masih ada setelah DELETE';
    END
    ELSE
    BEGIN
        PRINT N'OK: A06 DELETE ekstraksi saat transaksi DRAFT berhasil';
    END
END TRY
BEGIN CATCH
    PRINT N'MASALAH: A06 ' + CAST(ERROR_NUMBER() AS NVARCHAR(10)) + N' ' + LEFT(ERROR_MESSAGE(), 160);
END CATCH
GO
-- A07: pemilik lama LEFT dan pemilik baru ACTIVE di grup yang sama
DECLARE @g2 INT = (SELECT [v] FROM #ids WHERE [k] = N'g2'), @u1 INT = (SELECT [v] FROM #ids WHERE [k] = N'u1'), @u2 INT = (SELECT [v] FROM #ids WHERE [k] = N'u2');
BEGIN TRY
    INSERT INTO [dbo].[GroupMember] ([groupId], [userId], [role], [status], [leftAt]) VALUES (@g2, @u1, N'OWNER', N'LEFT', SYSUTCDATETIME()), (@g2, @u2, N'OWNER', N'ACTIVE', NULL);
    PRINT N'OK: A07 pemilik lama LEFT dan pemilik baru ACTIVE diterima';
END TRY
BEGIN CATCH
    PRINT N'MASALAH: A07 ' + CAST(ERROR_NUMBER() AS NVARCHAR(10)) + N' ' + LEFT(ERROR_MESSAGE(), 160);
END CATCH
GO
-- A08: notifikasi dengan payload JSON sah
DECLARE @u1 INT = (SELECT [v] FROM #ids WHERE [k] = N'u1');
BEGIN TRY
    INSERT INTO [dbo].[Notification] ([userId], [type], [payload]) VALUES (@u1, N'smoke', N'{"smoke":1}');
    PRINT N'OK: A08 notifikasi dengan payload JSON diterima';
END TRY
BEGIN CATCH
    PRINT N'MASALAH: A08 ' + CAST(ERROR_NUMBER() AS NVARCHAR(10)) + N' ' + LEFT(ERROR_MESSAGE(), 160);
END CATCH
GO
-- R01: pemilik aktif kedua di g2
DECLARE @g2 INT = (SELECT [v] FROM #ids WHERE [k] = N'g2'), @u3 INT = (SELECT [v] FROM #ids WHERE [k] = N'u3');
BEGIN TRY
    INSERT INTO [dbo].[GroupMember] ([groupId], [userId], [role], [status]) VALUES (@g2, @u3, N'OWNER', N'ACTIVE');
    PRINT N'MASALAH: R01 pemilik aktif kedua diterima';
END TRY
BEGIN CATCH
    IF ERROR_NUMBER() = 2601 AND ERROR_MESSAGE() LIKE N'%UX_GroupMember_OneActiveOwner%'
    BEGIN
        PRINT N'BENAR: R01 pemilik aktif kedua ditolak';
    END
    ELSE
    BEGIN
        PRINT N'MASALAH: R01 galat tak terduga ' + CAST(ERROR_NUMBER() AS NVARCHAR(10)) + N' ' + LEFT(ERROR_MESSAGE(), 160);
    END
END CATCH
GO
-- R02: role tidak valid
DECLARE @g2 INT = (SELECT [v] FROM #ids WHERE [k] = N'g2'), @u3 INT = (SELECT [v] FROM #ids WHERE [k] = N'u3');
BEGIN TRY
    INSERT INTO [dbo].[GroupMember] ([groupId], [userId], [role]) VALUES (@g2, @u3, N'BOSS');
    PRINT N'MASALAH: R02 role tidak valid diterima';
END TRY
BEGIN CATCH
    IF ERROR_NUMBER() = 547 AND ERROR_MESSAGE() LIKE N'%CK_GroupMember_role%'
    BEGIN
        PRINT N'BENAR: R02 role tidak valid ditolak';
    END
    ELSE
    BEGIN
        PRINT N'MASALAH: R02 galat tak terduga ' + CAST(ERROR_NUMBER() AS NVARCHAR(10)) + N' ' + LEFT(ERROR_MESSAGE(), 160);
    END
END CATCH
GO
-- R03: nominal transaksi melewati batas Rp100.000.000
DECLARE @g1 INT = (SELECT [v] FROM #ids WHERE [k] = N'g1'), @u1 INT = (SELECT [v] FROM #ids WHERE [k] = N'u1');
BEGIN TRY
    INSERT INTO [dbo].[Transaction] ([groupId], [payerId], [description], [amount]) VALUES (@g1, @u1, N'terlalu besar', 100000001);
    PRINT N'MASALAH: R03 nominal 100000001 diterima';
END TRY
BEGIN CATCH
    IF ERROR_NUMBER() = 547 AND ERROR_MESSAGE() LIKE N'%CK_Transaction_amount%'
    BEGIN
        PRINT N'BENAR: R03 nominal 100000001 ditolak';
    END
    ELSE
    BEGIN
        PRINT N'MASALAH: R03 galat tak terduga ' + CAST(ERROR_NUMBER() AS NVARCHAR(10)) + N' ' + LEFT(ERROR_MESSAGE(), 160);
    END
END CATCH
GO
-- R04: status transaksi tidak valid
DECLARE @g1 INT = (SELECT [v] FROM #ids WHERE [k] = N'g1'), @u1 INT = (SELECT [v] FROM #ids WHERE [k] = N'u1');
BEGIN TRY
    INSERT INTO [dbo].[Transaction] ([groupId], [payerId], [description], [amount], [status]) VALUES (@g1, @u1, N'status ngawur', 1000, N'LOST');
    PRINT N'MASALAH: R04 status tidak valid diterima';
END TRY
BEGIN CATCH
    IF ERROR_NUMBER() = 547 AND ERROR_MESSAGE() LIKE N'%CK_Transaction_status%'
    BEGIN
        PRINT N'BENAR: R04 status tidak valid ditolak';
    END
    ELSE
    BEGIN
        PRINT N'MASALAH: R04 galat tak terduga ' + CAST(ERROR_NUMBER() AS NVARCHAR(10)) + N' ' + LEFT(ERROR_MESSAGE(), 160);
    END
END CATCH
GO
-- R05: pelunasan dengan pengirim sama dengan penerima
DECLARE @g1 INT = (SELECT [v] FROM #ids WHERE [k] = N'g1'), @u2 INT = (SELECT [v] FROM #ids WHERE [k] = N'u2');
BEGIN TRY
    INSERT INTO [dbo].[PaymentConfirmation] ([groupId], [senderId], [receiverId], [amount], [methodType]) VALUES (@g1, @u2, @u2, 100, N'CASH');
    PRINT N'MASALAH: R05 pengirim sama dengan penerima diterima';
END TRY
BEGIN CATCH
    IF ERROR_NUMBER() = 547 AND ERROR_MESSAGE() LIKE N'%CK_PaymentConfirmation_parties%'
    BEGIN
        PRINT N'BENAR: R05 pengirim sama dengan penerima ditolak';
    END
    ELSE
    BEGIN
        PRINT N'MASALAH: R05 galat tak terduga ' + CAST(ERROR_NUMBER() AS NVARCHAR(10)) + N' ' + LEFT(ERROR_MESSAGE(), 160);
    END
END CATCH
GO
-- R06: pelunasan non-tunai tanpa bukti dan tanpa metode
DECLARE @g1 INT = (SELECT [v] FROM #ids WHERE [k] = N'g1'), @u1 INT = (SELECT [v] FROM #ids WHERE [k] = N'u1'), @u2 INT = (SELECT [v] FROM #ids WHERE [k] = N'u2');
BEGIN TRY
    INSERT INTO [dbo].[PaymentConfirmation] ([groupId], [senderId], [receiverId], [amount], [methodType]) VALUES (@g1, @u2, @u1, 100, N'BANK');
    PRINT N'MASALAH: R06 non-tunai tanpa bukti diterima';
END TRY
BEGIN CATCH
    IF ERROR_NUMBER() = 547 AND ERROR_MESSAGE() LIKE N'%CK_PaymentConfirmation_proof%'
    BEGIN
        PRINT N'BENAR: R06 non-tunai tanpa bukti ditolak';
    END
    ELSE
    BEGIN
        PRINT N'MASALAH: R06 galat tak terduga ' + CAST(ERROR_NUMBER() AS NVARCHAR(10)) + N' ' + LEFT(ERROR_MESSAGE(), 160);
    END
END CATCH
GO
-- R07: pelunasan dengan nominal 0
DECLARE @g1 INT = (SELECT [v] FROM #ids WHERE [k] = N'g1'), @u1 INT = (SELECT [v] FROM #ids WHERE [k] = N'u1'), @u2 INT = (SELECT [v] FROM #ids WHERE [k] = N'u2');
BEGIN TRY
    INSERT INTO [dbo].[PaymentConfirmation] ([groupId], [senderId], [receiverId], [amount], [methodType]) VALUES (@g1, @u2, @u1, 0, N'CASH');
    PRINT N'MASALAH: R07 pelunasan nominal 0 diterima';
END TRY
BEGIN CATCH
    IF ERROR_NUMBER() = 547 AND ERROR_MESSAGE() LIKE N'%CK_PaymentConfirmation_amount%'
    BEGIN
        PRINT N'BENAR: R07 pelunasan nominal 0 ditolak';
    END
    ELSE
    BEGIN
        PRINT N'MASALAH: R07 galat tak terduga ' + CAST(ERROR_NUMBER() AS NVARCHAR(10)) + N' ' + LEFT(ERROR_MESSAGE(), 160);
    END
END CATCH
GO
-- R08: CHARGE bertanda minus
DECLARE @g1 INT = (SELECT [v] FROM #ids WHERE [k] = N'g1'), @u1 INT = (SELECT [v] FROM #ids WHERE [k] = N'u1'), @u2 INT = (SELECT [v] FROM #ids WHERE [k] = N'u2'), @t1 INT = (SELECT [v] FROM #ids WHERE [k] = N't1');
BEGIN TRY
    INSERT INTO [dbo].[LedgerEntry] ([groupId], [type], [sign], [amount], [debtorUserId], [creditorUserId], [category], [transactionId]) VALUES (@g1, N'CHARGE', -1, 100, @u2, @u1, N'GROUP', @t1);
    PRINT N'MASALAH: R08 CHARGE bertanda minus diterima';
END TRY
BEGIN CATCH
    IF ERROR_NUMBER() = 547 AND ERROR_MESSAGE() LIKE N'%CK_LedgerEntry_shape%'
    BEGIN
        PRINT N'BENAR: R08 CHARGE bertanda minus ditolak';
    END
    ELSE
    BEGIN
        PRINT N'MASALAH: R08 galat tak terduga ' + CAST(ERROR_NUMBER() AS NVARCHAR(10)) + N' ' + LEFT(ERROR_MESSAGE(), 160);
    END
END CATCH
GO
-- R09: ledger dengan pengutang sama dengan kreditur
DECLARE @g1 INT = (SELECT [v] FROM #ids WHERE [k] = N'g1'), @u2 INT = (SELECT [v] FROM #ids WHERE [k] = N'u2'), @t1 INT = (SELECT [v] FROM #ids WHERE [k] = N't1');
BEGIN TRY
    INSERT INTO [dbo].[LedgerEntry] ([groupId], [type], [sign], [amount], [debtorUserId], [creditorUserId], [category], [transactionId]) VALUES (@g1, N'CHARGE', 1, 100, @u2, @u2, N'GROUP', @t1);
    PRINT N'MASALAH: R09 pengutang sama dengan kreditur diterima';
END TRY
BEGIN CATCH
    IF ERROR_NUMBER() = 547 AND ERROR_MESSAGE() LIKE N'%CK_LedgerEntry_parties%'
    BEGIN
        PRINT N'BENAR: R09 pengutang sama dengan kreditur ditolak';
    END
    ELSE
    BEGIN
        PRINT N'MASALAH: R09 galat tak terduga ' + CAST(ERROR_NUMBER() AS NVARCHAR(10)) + N' ' + LEFT(ERROR_MESSAGE(), 160);
    END
END CATCH
GO
-- R10: ledger dengan nominal 0
DECLARE @g1 INT = (SELECT [v] FROM #ids WHERE [k] = N'g1'), @u1 INT = (SELECT [v] FROM #ids WHERE [k] = N'u1'), @u2 INT = (SELECT [v] FROM #ids WHERE [k] = N'u2'), @t1 INT = (SELECT [v] FROM #ids WHERE [k] = N't1');
BEGIN TRY
    INSERT INTO [dbo].[LedgerEntry] ([groupId], [type], [sign], [amount], [debtorUserId], [creditorUserId], [category], [transactionId]) VALUES (@g1, N'CHARGE', 1, 0, @u2, @u1, N'GROUP', @t1);
    PRINT N'MASALAH: R10 nominal ledger 0 diterima';
END TRY
BEGIN CATCH
    IF ERROR_NUMBER() = 547 AND ERROR_MESSAGE() LIKE N'%CK_LedgerEntry_amount%'
    BEGIN
        PRINT N'BENAR: R10 nominal ledger 0 ditolak';
    END
    ELSE
    BEGIN
        PRINT N'MASALAH: R10 galat tak terduga ' + CAST(ERROR_NUMBER() AS NVARCHAR(10)) + N' ' + LEFT(ERROR_MESSAGE(), 160);
    END
END CATCH
GO
-- R11: UPDATE LedgerEntry
DECLARE @c1 INT = (SELECT [v] FROM #ids WHERE [k] = N'c1');
BEGIN TRY
    UPDATE [dbo].[LedgerEntry] SET [amount] = 1 WHERE [id] = @c1;
    PRINT N'MASALAH: R11 UPDATE ledger diterima';
END TRY
BEGIN CATCH
    IF ERROR_NUMBER() = 51001
    BEGIN
        PRINT N'BENAR: R11 UPDATE ledger ditolak';
    END
    ELSE
    BEGIN
        PRINT N'MASALAH: R11 galat tak terduga ' + CAST(ERROR_NUMBER() AS NVARCHAR(10)) + N' ' + LEFT(ERROR_MESSAGE(), 160);
    END
END CATCH
GO
-- R12: DELETE LedgerEntry
DECLARE @c1 INT = (SELECT [v] FROM #ids WHERE [k] = N'c1');
BEGIN TRY
    DELETE FROM [dbo].[LedgerEntry] WHERE [id] = @c1;
    PRINT N'MASALAH: R12 DELETE ledger diterima';
END TRY
BEGIN CATCH
    IF ERROR_NUMBER() = 51001
    BEGIN
        PRINT N'BENAR: R12 DELETE ledger ditolak';
    END
    ELSE
    BEGIN
        PRINT N'MASALAH: R12 galat tak terduga ' + CAST(ERROR_NUMBER() AS NVARCHAR(10)) + N' ' + LEFT(ERROR_MESSAGE(), 160);
    END
END CATCH
GO
-- R13: REVERSAL kedua atas baris yang sama
DECLARE @g1 INT = (SELECT [v] FROM #ids WHERE [k] = N'g1'), @u1 INT = (SELECT [v] FROM #ids WHERE [k] = N'u1'), @u2 INT = (SELECT [v] FROM #ids WHERE [k] = N'u2'), @t1 INT = (SELECT [v] FROM #ids WHERE [k] = N't1'), @c1 INT = (SELECT [v] FROM #ids WHERE [k] = N'c1');
BEGIN TRY
    INSERT INTO [dbo].[LedgerEntry] ([groupId], [type], [sign], [amount], [debtorUserId], [creditorUserId], [category], [transactionId], [reversesEntryId]) VALUES (@g1, N'REVERSAL', -1, 23333, @u2, @u1, N'GROUP', @t1, @c1);
    PRINT N'MASALAH: R13 REVERSAL kedua diterima';
END TRY
BEGIN CATCH
    IF ERROR_NUMBER() = 2601 AND ERROR_MESSAGE() LIKE N'%UX_LedgerEntry_Reverses%'
    BEGIN
        PRINT N'BENAR: R13 REVERSAL kedua ditolak';
    END
    ELSE
    BEGIN
        PRINT N'MASALAH: R13 galat tak terduga ' + CAST(ERROR_NUMBER() AS NVARCHAR(10)) + N' ' + LEFT(ERROR_MESSAGE(), 160);
    END
END CATCH
GO
-- R14: UPDATE AuditLog
DECLARE @a1 INT = (SELECT [v] FROM #ids WHERE [k] = N'a1');
BEGIN TRY
    UPDATE [dbo].[AuditLog] SET [reason] = N'ubah' WHERE [id] = @a1;
    PRINT N'MASALAH: R14 UPDATE audit diterima';
END TRY
BEGIN CATCH
    IF ERROR_NUMBER() = 51002
    BEGIN
        PRINT N'BENAR: R14 UPDATE audit ditolak';
    END
    ELSE
    BEGIN
        PRINT N'MASALAH: R14 galat tak terduga ' + CAST(ERROR_NUMBER() AS NVARCHAR(10)) + N' ' + LEFT(ERROR_MESSAGE(), 160);
    END
END CATCH
GO
-- R15: AuditLog dengan newValue bukan JSON
DECLARE @g1 INT = (SELECT [v] FROM #ids WHERE [k] = N'g1'), @u1 INT = (SELECT [v] FROM #ids WHERE [k] = N'u1');
BEGIN TRY
    INSERT INTO [dbo].[AuditLog] ([groupId], [actorId], [entity], [action], [newValue]) VALUES (@g1, @u1, N'Smoke', N'TEST', N'bukan json');
    PRINT N'MASALAH: R15 newValue bukan JSON diterima';
END TRY
BEGIN CATCH
    IF ERROR_NUMBER() = 547 AND ERROR_MESSAGE() LIKE N'%CK_AuditLog_newValue%'
    BEGIN
        PRINT N'BENAR: R15 newValue bukan JSON ditolak';
    END
    ELSE
    BEGIN
        PRINT N'MASALAH: R15 galat tak terduga ' + CAST(ERROR_NUMBER() AS NVARCHAR(10)) + N' ' + LEFT(ERROR_MESSAGE(), 160);
    END
END CATCH
GO
-- R16: UPDATE ReceiptExtraction
DECLARE @e1 INT = (SELECT [v] FROM #ids WHERE [k] = N'e1');
BEGIN TRY
    UPDATE [dbo].[ReceiptExtraction] SET [merchant] = N'ubah' WHERE [id] = @e1;
    PRINT N'MASALAH: R16 UPDATE ekstraksi diterima';
END TRY
BEGIN CATCH
    IF ERROR_NUMBER() = 51003
    BEGIN
        PRINT N'BENAR: R16 UPDATE ekstraksi ditolak';
    END
    ELSE
    BEGIN
        PRINT N'MASALAH: R16 galat tak terduga ' + CAST(ERROR_NUMBER() AS NVARCHAR(10)) + N' ' + LEFT(ERROR_MESSAGE(), 160);
    END
END CATCH
GO
-- R17: DELETE ReceiptExtraction saat transaksi bukan DRAFT
DECLARE @e1 INT = (SELECT [v] FROM #ids WHERE [k] = N'e1');
BEGIN TRY
    DELETE FROM [dbo].[ReceiptExtraction] WHERE [id] = @e1;
    PRINT N'MASALAH: R17 DELETE ekstraksi (transaksi ACTIVE) diterima';
END TRY
BEGIN CATCH
    IF ERROR_NUMBER() = 51004
    BEGIN
        PRINT N'BENAR: R17 DELETE ekstraksi (transaksi ACTIVE) ditolak';
    END
    ELSE
    BEGIN
        PRINT N'MASALAH: R17 galat tak terduga ' + CAST(ERROR_NUMBER() AS NVARCHAR(10)) + N' ' + LEFT(ERROR_MESSAGE(), 160);
    END
END CATCH
GO
-- R18: Approval dengan required lebih besar dari eligibleCount
DECLARE @g1 INT = (SELECT [v] FROM #ids WHERE [k] = N'g1'), @u1 INT = (SELECT [v] FROM #ids WHERE [k] = N'u1'), @t1 INT = (SELECT [v] FROM #ids WHERE [k] = N't1');
BEGIN TRY
    INSERT INTO [dbo].[Approval] ([groupId], [subjectType], [subjectId], [rule], [requestedBy], [eligibleCount], [required], [expiresAt]) VALUES (@g1, N'TRANSACTION', @t1, N'MAJORITY', @u1, 2, 3, SYSUTCDATETIME());
    PRINT N'MASALAH: R18 required lebih besar dari eligibleCount diterima';
END TRY
BEGIN CATCH
    IF ERROR_NUMBER() = 547 AND ERROR_MESSAGE() LIKE N'%CK_Approval_counts%'
    BEGIN
        PRINT N'BENAR: R18 required lebih besar dari eligibleCount ditolak';
    END
    ELSE
    BEGIN
        PRINT N'MASALAH: R18 galat tak terduga ' + CAST(ERROR_NUMBER() AS NVARCHAR(10)) + N' ' + LEFT(ERROR_MESSAGE(), 160);
    END
END CATCH
GO
-- G1: celah yang diketahui, REVERSAL yang menunjuk baris SETTLEMENT
DECLARE @g1 INT = (SELECT [v] FROM #ids WHERE [k] = N'g1'), @u1 INT = (SELECT [v] FROM #ids WHERE [k] = N'u1'), @u2 INT = (SELECT [v] FROM #ids WHERE [k] = N'u2'), @t1 INT = (SELECT [v] FROM #ids WHERE [k] = N't1'), @s1 INT = (SELECT [v] FROM #ids WHERE [k] = N's1');
BEGIN TRY
    INSERT INTO [dbo].[LedgerEntry] ([groupId], [type], [sign], [amount], [debtorUserId], [creditorUserId], [category], [transactionId], [reversesEntryId]) VALUES (@g1, N'REVERSAL', -1, 100, @u2, @u1, N'GROUP', @t1, @s1);
    PRINT N'CELAH: G1 REVERSAL yang menunjuk SETTLEMENT diterima database, aturan dijaga aplikasi (K54)';
END TRY
BEGIN CATCH
    PRINT N'INFO: G1 ditolak database: ' + LEFT(ERROR_MESSAGE(), 160);
END CATCH
GO
PRINT N'SELESAI';
SET NOEXEC OFF;
GO
