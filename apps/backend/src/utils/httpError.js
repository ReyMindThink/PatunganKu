// Galat yang sengaja dilempar kode aplikasi. "errors" hanya dipakai validation-failed:
// daftar objek { field, message }.
export class HttpError extends Error {
  constructor(status, code, message, errors) {
    super(message);
    this.status = status;
    this.code = code;
    if (errors) this.errors = errors;
  }
}
