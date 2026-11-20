-- Akun aplikasi untuk Azure SQL Database: hanya baca dan tulis data (tanpa DDL).
-- Jalankan sebagai admin server, terhubung ke DATABASE aplikasi (bukan master).
-- Ganti kata sandi sebelum menjalankan, lalu isi DB_USER dan DB_PASSWORD di .env VM.
-- Migrasi (DDL) memakai akun lain (admin atau akun migrasi) lewat DATABASE_URL.
CREATE USER [pk_app] WITH PASSWORD = 'GANTI_DENGAN_KATA_SANDI_KUAT';
ALTER ROLE db_datareader ADD MEMBER [pk_app];
ALTER ROLE db_datawriter ADD MEMBER [pk_app];
