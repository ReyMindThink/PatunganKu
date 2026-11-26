// Penanda proses sedang berhenti. Dibaca oleh /api/health/ready supaya penyeimbang beban
// berhenti mengirim lalu lintas sebelum server menutup koneksi.
let sedangMati = false;

export function tandaiShutdown() {
  sedangMati = true;
}

export function sedangShutdown() {
  return sedangMati;
}
