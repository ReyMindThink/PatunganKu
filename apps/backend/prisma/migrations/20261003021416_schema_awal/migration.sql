/*
  Warnings:

  - You are about to drop the `HealthCheck` table. If the table is not empty, all the data it contains will be lost.

*/
BEGIN TRY

BEGIN TRAN;

-- DropTable
DROP TABLE [dbo].[HealthCheck];

-- CreateTable
CREATE TABLE [dbo].[User] (
    [id] INT NOT NULL IDENTITY(1,1),
    [email] NVARCHAR(255) NOT NULL,
    [passwordHash] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [phone] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [User_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [User_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [User_email_key] UNIQUE NONCLUSTERED ([email])
);

-- CreateTable
CREATE TABLE [dbo].[Group] (
    [id] INT NOT NULL IDENTITY(1,1),
    [name] NVARCHAR(1000) NOT NULL,
    [code] NVARCHAR(20) NOT NULL,
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
    [role] NVARCHAR(20) NOT NULL CONSTRAINT [GroupMember_role_df] DEFAULT 'MEMBER',
    [joinedAt] DATETIME2 NOT NULL CONSTRAINT [GroupMember_joinedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [GroupMember_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [GroupMember_groupId_userId_key] UNIQUE NONCLUSTERED ([groupId],[userId])
);

-- CreateTable
CREATE TABLE [dbo].[Transaction] (
    [id] INT NOT NULL IDENTITY(1,1),
    [groupId] INT NOT NULL,
    [payerId] INT NOT NULL,
    [description] NVARCHAR(1000) NOT NULL,
    [amount] INT NOT NULL,
    [receiptUrl] NVARCHAR(1000),
    [receiptStatus] NVARCHAR(20) NOT NULL CONSTRAINT [Transaction_receiptStatus_df] DEFAULT 'PENDING',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Transaction_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Transaction_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[TransactionSplit] (
    [id] INT NOT NULL IDENTITY(1,1),
    [transactionId] INT NOT NULL,
    [userId] INT NOT NULL,
    [amount] INT NOT NULL,
    CONSTRAINT [TransactionSplit_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [TransactionSplit_transactionId_userId_key] UNIQUE NONCLUSTERED ([transactionId],[userId])
);

-- CreateTable
CREATE TABLE [dbo].[PaymentConfirmation] (
    [id] INT NOT NULL IDENTITY(1,1),
    [groupId] INT NOT NULL,
    [senderId] INT NOT NULL,
    [receiverId] INT NOT NULL,
    [amount] INT NOT NULL,
    [proofUrl] NVARCHAR(1000),
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [PaymentConfirmation_status_df] DEFAULT 'PENDING',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PaymentConfirmation_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [decidedAt] DATETIME2,
    CONSTRAINT [PaymentConfirmation_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- AddForeignKey
ALTER TABLE [dbo].[Group] ADD CONSTRAINT [Group_createdBy_fkey] FOREIGN KEY ([createdBy]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[GroupMember] ADD CONSTRAINT [GroupMember_groupId_fkey] FOREIGN KEY ([groupId]) REFERENCES [dbo].[Group]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[GroupMember] ADD CONSTRAINT [GroupMember_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Transaction] ADD CONSTRAINT [Transaction_groupId_fkey] FOREIGN KEY ([groupId]) REFERENCES [dbo].[Group]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Transaction] ADD CONSTRAINT [Transaction_payerId_fkey] FOREIGN KEY ([payerId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[TransactionSplit] ADD CONSTRAINT [TransactionSplit_transactionId_fkey] FOREIGN KEY ([transactionId]) REFERENCES [dbo].[Transaction]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[TransactionSplit] ADD CONSTRAINT [TransactionSplit_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PaymentConfirmation] ADD CONSTRAINT [PaymentConfirmation_groupId_fkey] FOREIGN KEY ([groupId]) REFERENCES [dbo].[Group]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PaymentConfirmation] ADD CONSTRAINT [PaymentConfirmation_senderId_fkey] FOREIGN KEY ([senderId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PaymentConfirmation] ADD CONSTRAINT [PaymentConfirmation_receiverId_fkey] FOREIGN KEY ([receiverId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
