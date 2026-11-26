BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[User] (
    [id] INT NOT NULL IDENTITY(1,1),
    [email] NVARCHAR(254) NOT NULL,
    [passwordHash] NVARCHAR(255) NOT NULL,
    [name] NVARCHAR(100) NOT NULL,
    [notifyByEmail] BIT NOT NULL CONSTRAINT [User_notifyByEmail_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [User_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [User_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [User_email_key] UNIQUE NONCLUSTERED ([email])
);

-- CreateTable
CREATE TABLE [dbo].[Group] (
    [id] INT NOT NULL IDENTITY(1,1),
    [name] NVARCHAR(100) NOT NULL,
    [code] NVARCHAR(10) NOT NULL,
    [createdBy] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Group_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Group_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Group_code_key] UNIQUE NONCLUSTERED ([code])
);

-- CreateTable
CREATE TABLE [dbo].[GroupMember] (
    [id] INT NOT NULL IDENTITY(1,1),
    [groupId] INT NOT NULL,
    [userId] INT NOT NULL,
    [role] NVARCHAR(10) NOT NULL CONSTRAINT [GroupMember_role_df] DEFAULT 'MEMBER',
    [status] NVARCHAR(10) NOT NULL CONSTRAINT [GroupMember_status_df] DEFAULT 'ACTIVE',
    [joinedAt] DATETIME2 NOT NULL CONSTRAINT [GroupMember_joinedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [leftAt] DATETIME2,
    [leftReason] NVARCHAR(500),
    CONSTRAINT [GroupMember_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [GroupMember_groupId_userId_key] UNIQUE NONCLUSTERED ([groupId],[userId])
);

-- CreateTable
CREATE TABLE [dbo].[Transaction] (
    [id] INT NOT NULL IDENTITY(1,1),
    [groupId] INT NOT NULL,
    [payerId] INT NOT NULL,
    [description] NVARCHAR(500) NOT NULL,
    [amount] INT NOT NULL,
    [mode] NVARCHAR(15) NOT NULL CONSTRAINT [Transaction_mode_df] DEFAULT 'EQUAL_ALL',
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [Transaction_status_df] DEFAULT 'DRAFT',
    [receiptUrl] NVARCHAR(500),
    [receiptStatus] NVARCHAR(15) NOT NULL CONSTRAINT [Transaction_receiptStatus_df] DEFAULT 'PENDING',
    [imageSha256] CHAR(64),
    [fingerprint] CHAR(64),
    [version] INT NOT NULL CONSTRAINT [Transaction_version_df] DEFAULT 1,
    [expiresAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Transaction_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Transaction_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[TransactionShare] (
    [id] INT NOT NULL IDENTITY(1,1),
    [transactionId] INT NOT NULL,
    [userId] INT NOT NULL,
    [amount] INT NOT NULL,
    [consent] NVARCHAR(10) NOT NULL CONSTRAINT [TransactionShare_consent_df] DEFAULT 'PENDING',
    [consentAt] DATETIME2,
    CONSTRAINT [TransactionShare_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [TransactionShare_transactionId_userId_key] UNIQUE NONCLUSTERED ([transactionId],[userId])
);

-- CreateTable
CREATE TABLE [dbo].[PaymentConfirmation] (
    [id] INT NOT NULL IDENTITY(1,1),
    [groupId] INT NOT NULL,
    [senderId] INT NOT NULL,
    [receiverId] INT NOT NULL,
    [amount] INT NOT NULL,
    [methodType] NVARCHAR(10) NOT NULL,
    [methodId] INT,
    [methodProvider] NVARCHAR(50),
    [methodAccountName] NVARCHAR(100),
    [note] NVARCHAR(500),
    [proofUrl] NVARCHAR(500),
    [status] NVARCHAR(10) NOT NULL CONSTRAINT [PaymentConfirmation_status_df] DEFAULT 'PENDING',
    [rejectReason] NVARCHAR(500),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PaymentConfirmation_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [decidedAt] DATETIME2,
    [cancelledAt] DATETIME2,
    CONSTRAINT [PaymentConfirmation_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[LedgerEntry] (
    [id] INT NOT NULL IDENTITY(1,1),
    [groupId] INT NOT NULL,
    [type] NVARCHAR(10) NOT NULL,
    [sign] INT NOT NULL,
    [amount] BIGINT NOT NULL,
    [debtorUserId] INT,
    [creditorUserId] INT,
    [category] NVARCHAR(10),
    [transactionId] INT,
    [paymentId] INT,
    [reversesEntryId] INT,
    [createdBy] INT,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [LedgerEntry_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [LedgerEntry_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[AuditLog] (
    [id] INT NOT NULL IDENTITY(1,1),
    [groupId] INT,
    [actorId] INT,
    [transactionId] INT,
    [entity] NVARCHAR(40) NOT NULL,
    [entityId] INT,
    [action] NVARCHAR(40) NOT NULL,
    [oldValue] NVARCHAR(max),
    [newValue] NVARCHAR(max),
    [reason] NVARCHAR(500),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AuditLog_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AuditLog_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ReceiptExtraction] (
    [id] INT NOT NULL IDENTITY(1,1),
    [transactionId] INT NOT NULL,
    [version] INT NOT NULL,
    [source] NVARCHAR(5) NOT NULL,
    [createdBy] INT,
    [merchant] NVARCHAR(200),
    [purchasedAt] DATETIME2,
    [subtotal] INT,
    [discount] INT,
    [service] INT,
    [shipping] INT,
    [tax] INT,
    [taxMode] NVARCHAR(10),
    [total] INT,
    [confidence] FLOAT(53),
    [arithmeticOk] BIT,
    [rawJson] NVARCHAR(max),
    [aiModel] NVARCHAR(60),
    [promptVersion] NVARCHAR(30),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ReceiptExtraction_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ReceiptExtraction_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ReceiptExtraction_transactionId_version_key] UNIQUE NONCLUSTERED ([transactionId],[version])
);

-- CreateTable
CREATE TABLE [dbo].[ReceiptItem] (
    [id] INT NOT NULL IDENTITY(1,1),
    [extractionId] INT NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [qty] INT NOT NULL,
    [unitPrice] INT NOT NULL,
    [subtotal] INT NOT NULL,
    CONSTRAINT [ReceiptItem_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Approval] (
    [id] INT NOT NULL IDENTITY(1,1),
    [groupId] INT NOT NULL,
    [subjectType] NVARCHAR(15) NOT NULL,
    [subjectId] INT NOT NULL,
    [rule] NVARCHAR(20) NOT NULL,
    [requestedBy] INT NOT NULL,
    [eligibleCount] INT NOT NULL,
    [required] INT NOT NULL,
    [status] NVARCHAR(10) NOT NULL CONSTRAINT [Approval_status_df] DEFAULT 'OPEN',
    [expiresAt] DATETIME2 NOT NULL,
    [decidedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Approval_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Approval_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ApprovalVote] (
    [id] INT NOT NULL IDENTITY(1,1),
    [approvalId] INT NOT NULL,
    [userId] INT NOT NULL,
    [vote] NVARCHAR(10) NOT NULL,
    [votedAt] DATETIME2 NOT NULL CONSTRAINT [ApprovalVote_votedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ApprovalVote_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ApprovalVote_approvalId_userId_key] UNIQUE NONCLUSTERED ([approvalId],[userId])
);

-- CreateTable
CREATE TABLE [dbo].[Notification] (
    [id] INT NOT NULL IDENTITY(1,1),
    [userId] INT NOT NULL,
    [groupId] INT,
    [type] NVARCHAR(40) NOT NULL,
    [payload] NVARCHAR(max) NOT NULL CONSTRAINT [Notification_payload_df] DEFAULT '{}',
    [readAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Notification_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Notification_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[PaymentMethod] (
    [id] INT NOT NULL IDENTITY(1,1),
    [userId] INT NOT NULL,
    [kind] NVARCHAR(10) NOT NULL,
    [provider] NVARCHAR(50),
    [accountNo] NVARCHAR(500),
    [accountName] NVARCHAR(100),
    [isActive] BIT NOT NULL CONSTRAINT [PaymentMethod_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PaymentMethod_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PaymentMethod_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[IdempotencyKey] (
    [id] INT NOT NULL IDENTITY(1,1),
    [userId] INT NOT NULL,
    [key] NVARCHAR(64) NOT NULL,
    [method] NVARCHAR(8) NOT NULL,
    [path] NVARCHAR(300) NOT NULL,
    [requestHash] CHAR(64) NOT NULL,
    [state] NVARCHAR(12) NOT NULL CONSTRAINT [IdempotencyKey_state_df] DEFAULT 'IN_PROGRESS',
    [statusCode] INT,
    [responseBody] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [IdempotencyKey_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [completedAt] DATETIME2,
    CONSTRAINT [IdempotencyKey_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [IdempotencyKey_userId_key_key] UNIQUE NONCLUSTERED ([userId],[key])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [GroupMember_userId_idx] ON [dbo].[GroupMember]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Transaction_groupId_createdAt_idx] ON [dbo].[Transaction]([groupId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Transaction_groupId_imageSha256_idx] ON [dbo].[Transaction]([groupId], [imageSha256]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Transaction_groupId_fingerprint_idx] ON [dbo].[Transaction]([groupId], [fingerprint]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Transaction_payerId_idx] ON [dbo].[Transaction]([payerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [TransactionShare_userId_idx] ON [dbo].[TransactionShare]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PaymentConfirmation_groupId_senderId_receiverId_idx] ON [dbo].[PaymentConfirmation]([groupId], [senderId], [receiverId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PaymentConfirmation_receiverId_status_idx] ON [dbo].[PaymentConfirmation]([receiverId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [LedgerEntry_groupId_debtorUserId_creditorUserId_idx] ON [dbo].[LedgerEntry]([groupId], [debtorUserId], [creditorUserId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [LedgerEntry_transactionId_idx] ON [dbo].[LedgerEntry]([transactionId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [LedgerEntry_paymentId_idx] ON [dbo].[LedgerEntry]([paymentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditLog_groupId_createdAt_idx] ON [dbo].[AuditLog]([groupId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditLog_transactionId_idx] ON [dbo].[AuditLog]([transactionId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditLog_actorId_idx] ON [dbo].[AuditLog]([actorId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ReceiptItem_extractionId_idx] ON [dbo].[ReceiptItem]([extractionId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Approval_groupId_status_idx] ON [dbo].[Approval]([groupId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Approval_subjectType_subjectId_idx] ON [dbo].[Approval]([subjectType], [subjectId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Approval_status_expiresAt_idx] ON [dbo].[Approval]([status], [expiresAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ApprovalVote_userId_idx] ON [dbo].[ApprovalVote]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Notification_userId_readAt_idx] ON [dbo].[Notification]([userId], [readAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Notification_userId_createdAt_idx] ON [dbo].[Notification]([userId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PaymentMethod_userId_isActive_idx] ON [dbo].[PaymentMethod]([userId], [isActive]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IdempotencyKey_createdAt_idx] ON [dbo].[IdempotencyKey]([createdAt]);

-- AddForeignKey
ALTER TABLE [dbo].[Group] ADD CONSTRAINT [Group_createdBy_fkey] FOREIGN KEY ([createdBy]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[GroupMember] ADD CONSTRAINT [GroupMember_groupId_fkey] FOREIGN KEY ([groupId]) REFERENCES [dbo].[Group]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[GroupMember] ADD CONSTRAINT [GroupMember_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Transaction] ADD CONSTRAINT [Transaction_groupId_fkey] FOREIGN KEY ([groupId]) REFERENCES [dbo].[Group]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Transaction] ADD CONSTRAINT [Transaction_payerId_fkey] FOREIGN KEY ([payerId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[TransactionShare] ADD CONSTRAINT [TransactionShare_transactionId_fkey] FOREIGN KEY ([transactionId]) REFERENCES [dbo].[Transaction]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[TransactionShare] ADD CONSTRAINT [TransactionShare_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PaymentConfirmation] ADD CONSTRAINT [PaymentConfirmation_groupId_fkey] FOREIGN KEY ([groupId]) REFERENCES [dbo].[Group]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PaymentConfirmation] ADD CONSTRAINT [PaymentConfirmation_senderId_fkey] FOREIGN KEY ([senderId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PaymentConfirmation] ADD CONSTRAINT [PaymentConfirmation_receiverId_fkey] FOREIGN KEY ([receiverId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PaymentConfirmation] ADD CONSTRAINT [PaymentConfirmation_methodId_fkey] FOREIGN KEY ([methodId]) REFERENCES [dbo].[PaymentMethod]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LedgerEntry] ADD CONSTRAINT [LedgerEntry_groupId_fkey] FOREIGN KEY ([groupId]) REFERENCES [dbo].[Group]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LedgerEntry] ADD CONSTRAINT [LedgerEntry_debtorUserId_fkey] FOREIGN KEY ([debtorUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LedgerEntry] ADD CONSTRAINT [LedgerEntry_creditorUserId_fkey] FOREIGN KEY ([creditorUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LedgerEntry] ADD CONSTRAINT [LedgerEntry_createdBy_fkey] FOREIGN KEY ([createdBy]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LedgerEntry] ADD CONSTRAINT [LedgerEntry_transactionId_fkey] FOREIGN KEY ([transactionId]) REFERENCES [dbo].[Transaction]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LedgerEntry] ADD CONSTRAINT [LedgerEntry_paymentId_fkey] FOREIGN KEY ([paymentId]) REFERENCES [dbo].[PaymentConfirmation]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LedgerEntry] ADD CONSTRAINT [LedgerEntry_reversesEntryId_fkey] FOREIGN KEY ([reversesEntryId]) REFERENCES [dbo].[LedgerEntry]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AuditLog] ADD CONSTRAINT [AuditLog_groupId_fkey] FOREIGN KEY ([groupId]) REFERENCES [dbo].[Group]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AuditLog] ADD CONSTRAINT [AuditLog_actorId_fkey] FOREIGN KEY ([actorId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AuditLog] ADD CONSTRAINT [AuditLog_transactionId_fkey] FOREIGN KEY ([transactionId]) REFERENCES [dbo].[Transaction]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ReceiptExtraction] ADD CONSTRAINT [ReceiptExtraction_transactionId_fkey] FOREIGN KEY ([transactionId]) REFERENCES [dbo].[Transaction]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ReceiptExtraction] ADD CONSTRAINT [ReceiptExtraction_createdBy_fkey] FOREIGN KEY ([createdBy]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ReceiptItem] ADD CONSTRAINT [ReceiptItem_extractionId_fkey] FOREIGN KEY ([extractionId]) REFERENCES [dbo].[ReceiptExtraction]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Approval] ADD CONSTRAINT [Approval_groupId_fkey] FOREIGN KEY ([groupId]) REFERENCES [dbo].[Group]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Approval] ADD CONSTRAINT [Approval_requestedBy_fkey] FOREIGN KEY ([requestedBy]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ApprovalVote] ADD CONSTRAINT [ApprovalVote_approvalId_fkey] FOREIGN KEY ([approvalId]) REFERENCES [dbo].[Approval]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ApprovalVote] ADD CONSTRAINT [ApprovalVote_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Notification] ADD CONSTRAINT [Notification_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Notification] ADD CONSTRAINT [Notification_groupId_fkey] FOREIGN KEY ([groupId]) REFERENCES [dbo].[Group]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PaymentMethod] ADD CONSTRAINT [PaymentMethod_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[IdempotencyKey] ADD CONSTRAINT [IdempotencyKey_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

-- ============================================================================
-- Pengaman database v2 Tahap 1 (SQL mentah). Rancangan: docs/architecture.md bagian 6 dan K53.
-- Prisma tidak dapat menyatakan CHECK, trigger, maupun indeks unik terfilter.
-- Trigger dibuat lewat EXEC karena CREATE TRIGGER harus berada di awal batch.
-- ============================================================================
BEGIN TRY
BEGIN TRAN;

-- GroupMember
ALTER TABLE [dbo].[GroupMember] ADD CONSTRAINT [CK_GroupMember_role] CHECK ([role] IN (N'OWNER', N'ADMIN', N'MEMBER'));
ALTER TABLE [dbo].[GroupMember] ADD CONSTRAINT [CK_GroupMember_status] CHECK ([status] IN (N'ACTIVE', N'LEFT', N'REMOVED'));
CREATE UNIQUE NONCLUSTERED INDEX [UX_GroupMember_OneActiveOwner] ON [dbo].[GroupMember]([groupId]) WHERE [role] = N'OWNER' AND [status] = N'ACTIVE';

-- Transaction
ALTER TABLE [dbo].[Transaction] ADD CONSTRAINT [CK_Transaction_mode] CHECK ([mode] IN (N'EQUAL_ALL', N'EQUAL_SUBSET', N'CUSTOM', N'ITEMIZED'));
ALTER TABLE [dbo].[Transaction] ADD CONSTRAINT [CK_Transaction_status] CHECK ([status] IN (N'DRAFT', N'PENDING_APPROVAL', N'ACTIVE', N'REJECTED', N'EXPIRED', N'WITHDRAWN', N'TAKEN_DOWN'));
ALTER TABLE [dbo].[Transaction] ADD CONSTRAINT [CK_Transaction_receiptStatus] CHECK ([receiptStatus] IN (N'PENDING', N'VERIFIED', N'FAILED', N'NEEDS_REVIEW'));
ALTER TABLE [dbo].[Transaction] ADD CONSTRAINT [CK_Transaction_amount] CHECK ([amount] > 0 AND [amount] <= 100000000);
ALTER TABLE [dbo].[Transaction] ADD CONSTRAINT [CK_Transaction_version] CHECK ([version] >= 1);

-- TransactionShare
ALTER TABLE [dbo].[TransactionShare] ADD CONSTRAINT [CK_TransactionShare_consent] CHECK ([consent] IN (N'PENDING', N'ACCEPTED', N'REJECTED'));
ALTER TABLE [dbo].[TransactionShare] ADD CONSTRAINT [CK_TransactionShare_amount] CHECK ([amount] >= 0);

-- PaymentConfirmation
ALTER TABLE [dbo].[PaymentConfirmation] ADD CONSTRAINT [CK_PaymentConfirmation_methodType] CHECK ([methodType] IN (N'BANK', N'EWALLET', N'CASH'));
ALTER TABLE [dbo].[PaymentConfirmation] ADD CONSTRAINT [CK_PaymentConfirmation_status] CHECK ([status] IN (N'PENDING', N'CONFIRMED', N'REJECTED', N'CANCELLED'));
ALTER TABLE [dbo].[PaymentConfirmation] ADD CONSTRAINT [CK_PaymentConfirmation_amount] CHECK ([amount] > 0);
ALTER TABLE [dbo].[PaymentConfirmation] ADD CONSTRAINT [CK_PaymentConfirmation_parties] CHECK ([senderId] <> [receiverId]);
ALTER TABLE [dbo].[PaymentConfirmation] ADD CONSTRAINT [CK_PaymentConfirmation_proof] CHECK ([methodType] = N'CASH' OR ([proofUrl] IS NOT NULL AND [methodId] IS NOT NULL));

-- LedgerEntry
ALTER TABLE [dbo].[LedgerEntry] ADD CONSTRAINT [CK_LedgerEntry_type] CHECK ([type] IN (N'CHARGE', N'REVERSAL', N'SETTLEMENT'));
ALTER TABLE [dbo].[LedgerEntry] ADD CONSTRAINT [CK_LedgerEntry_sign] CHECK ([sign] IN (1, -1));
ALTER TABLE [dbo].[LedgerEntry] ADD CONSTRAINT [CK_LedgerEntry_amount] CHECK ([amount] > 0);
ALTER TABLE [dbo].[LedgerEntry] ADD CONSTRAINT [CK_LedgerEntry_category] CHECK ([category] IS NULL OR [category] IN (N'GROUP', N'INDIVIDUAL'));
ALTER TABLE [dbo].[LedgerEntry] ADD CONSTRAINT [CK_LedgerEntry_parties] CHECK ([debtorUserId] IS NOT NULL AND [creditorUserId] IS NOT NULL AND [debtorUserId] <> [creditorUserId]);
ALTER TABLE [dbo].[LedgerEntry] ADD CONSTRAINT [CK_LedgerEntry_shape] CHECK (
    ([type] = N'CHARGE' AND [sign] = 1 AND [transactionId] IS NOT NULL AND [category] IS NOT NULL AND [paymentId] IS NULL AND [reversesEntryId] IS NULL)
    OR ([type] = N'SETTLEMENT' AND [sign] = -1 AND [paymentId] IS NOT NULL AND [transactionId] IS NULL AND [reversesEntryId] IS NULL)
    OR ([type] = N'REVERSAL' AND [sign] = -1 AND [reversesEntryId] IS NOT NULL AND [transactionId] IS NOT NULL AND [category] IS NOT NULL AND [paymentId] IS NULL)
);
CREATE UNIQUE NONCLUSTERED INDEX [UX_LedgerEntry_Reverses] ON [dbo].[LedgerEntry]([reversesEntryId]) WHERE [reversesEntryId] IS NOT NULL;

-- ReceiptExtraction dan ReceiptItem
ALTER TABLE [dbo].[ReceiptExtraction] ADD CONSTRAINT [CK_ReceiptExtraction_source] CHECK ([source] IN (N'AI', N'ADMIN'));
ALTER TABLE [dbo].[ReceiptExtraction] ADD CONSTRAINT [CK_ReceiptExtraction_taxMode] CHECK ([taxMode] IS NULL OR [taxMode] IN (N'EXCLUSIVE', N'INCLUSIVE', N'UNKNOWN'));
ALTER TABLE [dbo].[ReceiptExtraction] ADD CONSTRAINT [CK_ReceiptExtraction_confidence] CHECK ([confidence] IS NULL OR ([confidence] >= 0 AND [confidence] <= 1));
ALTER TABLE [dbo].[ReceiptExtraction] ADD CONSTRAINT [CK_ReceiptExtraction_version] CHECK ([version] >= 1);
ALTER TABLE [dbo].[ReceiptItem] ADD CONSTRAINT [CK_ReceiptItem_values] CHECK ([qty] > 0 AND [unitPrice] >= 0 AND [subtotal] >= 0);

-- Approval dan ApprovalVote
ALTER TABLE [dbo].[Approval] ADD CONSTRAINT [CK_Approval_subjectType] CHECK ([subjectType] IN (N'TRANSACTION', N'REVISION'));
ALTER TABLE [dbo].[Approval] ADD CONSTRAINT [CK_Approval_rule] CHECK ([rule] IN (N'ADMIN_ANY', N'ADMIN_OTHER', N'QUORUM_20', N'MAJORITY'));
ALTER TABLE [dbo].[Approval] ADD CONSTRAINT [CK_Approval_status] CHECK ([status] IN (N'OPEN', N'APPROVED', N'REJECTED', N'EXPIRED', N'CANCELLED'));
ALTER TABLE [dbo].[Approval] ADD CONSTRAINT [CK_Approval_counts] CHECK ([eligibleCount] >= 1 AND [required] >= 1 AND [required] <= [eligibleCount]);
ALTER TABLE [dbo].[ApprovalVote] ADD CONSTRAINT [CK_ApprovalVote_vote] CHECK ([vote] IN (N'APPROVE', N'REJECT'));

-- Notification dan AuditLog: JSON hanya diperiksa pada kolom yang ditulis sistem sendiri
ALTER TABLE [dbo].[Notification] ADD CONSTRAINT [CK_Notification_payload] CHECK (ISJSON([payload]) = 1);
ALTER TABLE [dbo].[AuditLog] ADD CONSTRAINT [CK_AuditLog_oldValue] CHECK ([oldValue] IS NULL OR ISJSON([oldValue]) = 1);
ALTER TABLE [dbo].[AuditLog] ADD CONSTRAINT [CK_AuditLog_newValue] CHECK ([newValue] IS NULL OR ISJSON([newValue]) = 1);

-- PaymentMethod dan IdempotencyKey
ALTER TABLE [dbo].[PaymentMethod] ADD CONSTRAINT [CK_PaymentMethod_kind] CHECK ([kind] IN (N'BANK', N'EWALLET', N'CASH'));
ALTER TABLE [dbo].[PaymentMethod] ADD CONSTRAINT [CK_PaymentMethod_details] CHECK ([kind] = N'CASH' OR [isActive] = 0 OR ([provider] IS NOT NULL AND [accountNo] IS NOT NULL AND [accountName] IS NOT NULL));
ALTER TABLE [dbo].[IdempotencyKey] ADD CONSTRAINT [CK_IdempotencyKey_state] CHECK ([state] IN (N'IN_PROGRESS', N'COMPLETED'));
ALTER TABLE [dbo].[IdempotencyKey] ADD CONSTRAINT [CK_IdempotencyKey_completed] CHECK ([state] = N'IN_PROGRESS' OR [statusCode] IS NOT NULL);

-- Trigger tambah-saja: LedgerEntry dan AuditLog menolak UPDATE dan DELETE
EXEC(N'CREATE TRIGGER [dbo].[TR_LedgerEntry_AppendOnly] ON [dbo].[LedgerEntry] INSTEAD OF UPDATE, DELETE AS
BEGIN
    SET NOCOUNT ON;
    THROW 51001, N''LedgerEntry bersifat tambah-saja: UPDATE dan DELETE ditolak.'', 1;
END');
EXEC(N'CREATE TRIGGER [dbo].[TR_AuditLog_AppendOnly] ON [dbo].[AuditLog] INSTEAD OF UPDATE, DELETE AS
BEGIN
    SET NOCOUNT ON;
    THROW 51002, N''AuditLog bersifat tambah-saja: UPDATE dan DELETE ditolak.'', 1;
END');

-- Trigger ReceiptExtraction: UPDATE selalu ditolak, DELETE hanya selama transaksi berstatus DRAFT (K53 butir 6)
EXEC(N'CREATE TRIGGER [dbo].[TR_ReceiptExtraction_AppendOnly] ON [dbo].[ReceiptExtraction] INSTEAD OF UPDATE, DELETE AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM inserted)
        THROW 51003, N''ReceiptExtraction bersifat tambah-saja: UPDATE ditolak.'', 1;
    IF EXISTS (SELECT 1 FROM deleted d INNER JOIN [dbo].[Transaction] t ON t.[id] = d.[transactionId] WHERE t.[status] <> N''DRAFT'')
        THROW 51004, N''ReceiptExtraction hanya dapat dihapus selama transaksi berstatus DRAFT.'', 1;
    DELETE FROM [dbo].[ReceiptExtraction] WHERE [id] IN (SELECT [id] FROM deleted);
END');

COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW
END CATCH
