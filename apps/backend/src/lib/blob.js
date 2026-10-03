import "dotenv/config";
import { randomUUID } from "node:crypto";
import { BlobServiceClient } from "@azure/storage-blob";

const CONTAINER = "receipts";

let containerPromise;

function getContainer() {
  if (!containerPromise) {
    const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!conn) throw new Error("AZURE_STORAGE_CONNECTION_STRING belum diisi di .env");
    const client = BlobServiceClient.fromConnectionString(conn).getContainerClient(CONTAINER);
    containerPromise = client.createIfNotExists().then(() => client);
    containerPromise.catch(() => {
      containerPromise = undefined;
    });
  }
  return containerPromise;
}

const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export async function uploadReceipt(buffer, contentType) {
  const container = await getContainer();
  const name = `${randomUUID()}.${EXT[contentType] ?? "bin"}`;
  await container.getBlockBlobClient(name).uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: contentType },
  });
  return name;
}

export async function downloadReceipt(name) {
  const container = await getContainer();
  return container.getBlobClient(name).download();
}

export async function readReceiptBuffer(name) {
  const container = await getContainer();
  return container.getBlobClient(name).downloadToBuffer();
}
