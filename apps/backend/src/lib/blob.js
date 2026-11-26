import "dotenv/config";
import { randomUUID } from "node:crypto";
import { BlobServiceClient } from "@azure/storage-blob";

const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

// Satu pabrik per container (receipts untuk struk, proofs untuk bukti pelunasan). Koneksi dibuat
// malas saat pertama dipakai, jadi mengimpor modul ini tidak menyentuh Azure.
export function buatPenyimpananBlob(namaContainer) {
  let containerPromise;

  function getContainer() {
    if (containerPromise === undefined) {
      const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
      if (Boolean(conn) === false) throw new Error("AZURE_STORAGE_CONNECTION_STRING belum diisi di .env");
      const client = BlobServiceClient.fromConnectionString(conn).getContainerClient(namaContainer);
      containerPromise = client.createIfNotExists().then(() => client);
      containerPromise.catch(() => {
        containerPromise = undefined;
      });
    }
    return containerPromise;
  }

  async function simpan(buffer, contentType) {
    const container = await getContainer();
    const name = `${randomUUID()}.${EXT[contentType] ?? "bin"}`;
    await container.getBlockBlobClient(name).uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: contentType },
    });
    return name;
  }

  async function unduhResponse(name) {
    const container = await getContainer();
    return container.getBlobClient(name).download();
  }

  async function baca(name) {
    const container = await getContainer();
    return container.getBlobClient(name).downloadToBuffer();
  }

  // Isi dan tipe berkas sekaligus; blob yang tidak ada melempar galat ber-statusCode 404.
  async function unduh(name) {
    const container = await getContainer();
    const blob = container.getBlobClient(name);
    const [buffer, sifat] = await Promise.all([blob.downloadToBuffer(), blob.getProperties()]);
    return { buffer, tipe: sifat.contentType };
  }

  async function hapus(name) {
    const container = await getContainer();
    await container.getBlobClient(name).deleteIfExists();
  }

  return { simpan, unduhResponse, baca, unduh, hapus };
}

const struk = buatPenyimpananBlob("receipts");
export const uploadReceipt = struk.simpan;
export const downloadReceipt = struk.unduhResponse;
export const readReceiptBuffer = struk.baca;
export const deleteReceipt = struk.hapus;

// Bukti pelunasan (api-contract 10.4): container privat, dibaca hanya lewat endpoint backend.
export const penyimpananBukti = buatPenyimpananBlob("proofs");
