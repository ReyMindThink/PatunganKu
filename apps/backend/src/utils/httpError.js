// Galat yang sengaja dilempar kode aplikasi. "errors" hanya dipakai validation-failed:
// daftar objek { field, message }. "extra" memuat field tambahan pada badan problem+json
// (misalnya existingTransactionId pada duplicate-receipt); field baku tidak dapat ditimpa.
export class HttpError extends Error {
  constructor(status, code, message, errors, extra) {
    super(message);
    this.status = status;
    this.code = code;
    if (errors) this.errors = errors;
    if (extra) this.extra = extra;
  }
}
