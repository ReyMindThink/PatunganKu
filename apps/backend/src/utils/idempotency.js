// Idempotency-Key (api-contract 2.6). Murni: database dan jam disuntik. Dipakai sebagai
// pembungkus handler: idempoten(async (req, tx) => ({ status: 201, body: { data } })).
// Kunci direservasi (IN_PROGRESS, langsung ter-commit supaya permintaan paralel melihatnya),
// lalu aksi dan penandaan COMPLETED berjalan dalam SATU transaksi database: keduanya
// ter-commit bersama atau batal bersama. Hanya respons 2xx disimpan; galat melepas kunci.
import { createHash } from "node:crypto";
import { HttpError } from "./httpError.js";
import { IDEMPOTENSI } from "../config/constants.js";

const POLA_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PATH_MAKS = 300;
const PERCOBAAN_MAKS = 3;

const sha256 = (teks) => createHash("sha256").update(teks, "utf8").digest("hex");

// JSON kanonik: kunci objek diurutkan, jadi urutan field tidak memengaruhi sidik jari.
function kanonik(nilai) {
  if (Array.isArray(nilai)) return "[" + nilai.map(kanonik).join(",") + "]";
  if (Object.prototype.toString.call(nilai) === "[object Object]") {
    const kunci = Object.keys(nilai).sort();
    return "{" + kunci.map((k) => JSON.stringify(k) + ":" + kanonik(nilai[k])).join(",") + "}";
  }
  return JSON.stringify(nilai) ?? "null";
}

// Sidik jari bawaan: query dan isi JSON. Metode dan path dibandingkan lewat kolomnya sendiri.
const sidikBawaan = (req) => sha256(kanonik({ query: req.query, body: req.body ?? null }));

function bacaKunci(req) {
  const mentah = req.headers["idempotency-key"];
  const teks = typeof mentah === "string" ? mentah.toLowerCase() : "";
  if (POLA_UUID_V4.test(teks) === false) {
    throw new HttpError(400, "validation-failed", "Data yang dikirim tidak valid.", [
      { field: "Idempotency-Key", message: teks === "" ? "Header wajib diisi." : "Harus berupa UUID v4." },
    ]);
  }
  return teks;
}

function kirim(res, status, body) {
  if (body === undefined || status === 204) {
    res.status(status).end();
    return;
  }
  res.status(status).json(body);
}

function kirimUlang(res, baris) {
  res.set("Idempotent-Replay", "true");
  kirim(res, baris.statusCode, baris.responseBody === null ? undefined : JSON.parse(baris.responseBody));
}

export function buatIdempotensi({
  db,
  sekarang = Date.now,
  ttlMs = IDEMPOTENSI.TTL_MS,
  prosesMs = IDEMPOTENSI.PROSES_KADALUWARSA_MS,
  opsiTransaksi = { timeout: 15000, maxWait: 5000 },
}) {
  // Hasilnya { id } bila permintaan ini boleh menjalankan aksi, atau { ulang } bila harus
  // memutar ulang respons tersimpan. Bentrok kunci dikenali dengan membaca ulang baris,
  // bukan dari kode galat Prisma.
  async function reservasi(data) {
    let galatAsli = null;
    let pernahAda = false;
    for (let i = 0; i < PERCOBAAN_MAKS; i++) {
      try {
        const baris = await db.idempotencyKey.create({ data, select: { id: true } });
        return { id: baris.id };
      } catch (e) {
        galatAsli = e;
      }
      const ada = await db.idempotencyKey.findUnique({ where: { userId_key: { userId: data.userId, key: data.key } } });
      if (ada === null) continue;
      pernahAda = true;

      const batas = new Date(ada.createdAt.getTime() + 1);
      const umur = sekarang() - ada.createdAt.getTime();
      if (umur > ttlMs) {
        await db.idempotencyKey.deleteMany({ where: { id: ada.id, createdAt: { lt: batas } } });
        continue;
      }

      const sama = ada.method === data.method && ada.path === data.path && ada.requestHash === data.requestHash;
      if (sama === false) {
        throw new HttpError(409, "idempotency-key-reuse", "Idempotency-Key ini sudah dipakai untuk permintaan yang berbeda.");
      }
      if (ada.state === "COMPLETED") return { ulang: ada };

      if (umur > prosesMs) {
        const hasil = await db.idempotencyKey.updateMany({
          where: { id: ada.id, state: "IN_PROGRESS", createdAt: { lt: batas } },
          data: { createdAt: new Date(sekarang()) },
        });
        if (hasil.count === 1) return { id: ada.id };
        continue;
      }
      throw new HttpError(409, "request-in-progress", "Permintaan dengan kunci yang sama masih diproses. Coba lagi sebentar.");
    }
    if (pernahAda) throw new HttpError(409, "request-in-progress", "Permintaan dengan kunci yang sama sedang diproses. Coba lagi sebentar.");
    throw galatAsli;
  }

  const lepas = (id) => db.idempotencyKey.deleteMany({ where: { id, state: "IN_PROGRESS" } }).catch(() => {});

  // fn(req, tx) mengembalikan { status 2xx, body }; body boleh kosong. Penulisan bisnis harus
  // lewat tx. opsi.sidik(req) dapat mengganti sidik jari bawaan (misalnya unggahan gambar).
  function idempoten(fn, { sidik = sidikBawaan } = {}) {
    return async function idempotenMw(req, res) {
      const userId = req.user?.id;
      if (userId === undefined) throw new HttpError(401, "unauthorized", "Token tidak ditemukan.");
      const key = bacaKunci(req);
      const path = req.originalUrl.split("?")[0];
      if (path.length > PATH_MAKS) throw new HttpError(400, "validation-failed", "Path permintaan terlalu panjang.");

      const r = await reservasi({ userId, key, method: req.method, path, requestHash: sidik(req) });
      if (r.ulang) {
        kirimUlang(res, r.ulang);
        return;
      }

      let keluaran;
      try {
        keluaran = await db.$transaction(async (tx) => {
          const hasil = await fn(req, tx);
          const sah = Number.isInteger(hasil?.status) && hasil.status >= 200 && hasil.status <= 299;
          if (sah === false) throw new Error("idempoten: handler harus mengembalikan { status 2xx, body }");
          await tx.idempotencyKey.update({
            where: { id: r.id },
            data: {
              state: "COMPLETED",
              statusCode: hasil.status,
              responseBody: hasil.body === undefined ? null : JSON.stringify(hasil.body),
              completedAt: new Date(sekarang()),
            },
          });
          return hasil;
        }, opsiTransaksi);
      } catch (e) {
        await lepas(r.id);
        throw e;
      }
      kirim(res, keluaran.status, keluaran.body);
    };
  }

  return { idempoten };
}
