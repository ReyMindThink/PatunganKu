// Bentuk galat API: setiap respons non-2xx yang dapat dipicu harus application/problem+json.
// Judul 413 mengikuti tabel Node (nama RFC-nya berbeda antar versi), jadi tidak ditulis literal.
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { STATUS_CODES } from "node:http";
import multer from "multer";
import { HttpError } from "../../src/utils/httpError.js";
import { errorHandler } from "../../src/middlewares/errorHandler.js";
import { mulaiAplikasi } from "../helpers/http.js";

let app;
let catat;

beforeEach(async () => {
  catat = mock.method(console, "error", () => {});
  app = await mulaiAplikasi((a) => {
    a.get("/forbidden", () => {
      throw new HttpError(403, "forbidden", "Tidak berhak atas grup ini.");
    });
    a.post("/validasi", () => {
      throw new HttpError(400, "validation-failed", "Data yang dikirim tidak valid.", [
        { field: "amount", message: "Harus bilangan bulat positif" },
      ]);
    });
    a.post("/json", (req, res) => res.json({ data: req.body }));
    a.get("/meledak", () => {
      throw new Error("rahasia-db-xyz");
    });
    a.get("/async-meledak", async () => {
      throw new Error("rahasia-db-xyz");
    });
    a.get("/multer-besar", () => {
      throw new multer.MulterError("LIMIT_FILE_SIZE", "receipt");
    });
    a.get("/multer-lain", () => {
      throw new multer.MulterError("LIMIT_UNEXPECTED_FILE", "foto");
    });
  });
});

afterEach(async () => {
  mock.restoreAll();
  await app.tutup();
});

const pemicu = [
  { nama: "HttpError 403", minta: (u) => fetch(u + "/forbidden"), status: 403, code: "forbidden", title: "Forbidden" },
  {
    nama: "validasi dengan errors",
    minta: (u) => fetch(u + "/validasi", { method: "POST" }),
    status: 400,
    code: "validation-failed",
    title: "Bad Request",
  },
  {
    nama: "JSON rusak",
    minta: (u) =>
      fetch(u + "/json", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{rusak" }),
    status: 400,
    code: "invalid-json",
    title: "Bad Request",
  },
  {
    nama: "body lebih dari 100 kB",
    minta: (u) =>
      fetch(u + "/json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x: "a".repeat(200 * 1024) }),
      }),
    status: 413,
    code: "payload-too-large",
  },
  { nama: "rute tidak ada", minta: (u) => fetch(u + "/tidak-ada"), status: 404, code: "not-found", title: "Not Found" },
  {
    nama: "galat tak terduga",
    minta: (u) => fetch(u + "/meledak"),
    status: 500,
    code: "internal-error",
    title: "Internal Server Error",
  },
  {
    nama: "promise ditolak di handler async",
    minta: (u) => fetch(u + "/async-meledak"),
    status: 500,
    code: "internal-error",
    title: "Internal Server Error",
  },
  {
    nama: "MulterError ukuran berkas",
    minta: (u) => fetch(u + "/multer-besar"),
    status: 413,
    code: "payload-too-large",
  },
  {
    nama: "MulterError lain",
    minta: (u) => fetch(u + "/multer-lain"),
    status: 400,
    code: "validation-failed",
    title: "Bad Request",
  },
];

describe("galat selalu application/problem+json", () => {
  for (const p of pemicu) {
    it(p.nama, async () => {
      const res = await p.minta(app.url);
      assert.equal(res.status, p.status);
      assert.match(res.headers.get("content-type"), /^application\/problem\+json/);
      const b = await res.json();
      assert.equal(b.type, "about:blank");
      assert.equal(b.status, p.status);
      assert.equal(b.code, p.code);
      assert.equal(b.title, p.title ?? STATUS_CODES[p.status]);
      assert.equal(typeof b.detail, "string");
      assert.ok(b.detail.length > 0);
    });
  }
});

describe("isi galat", () => {
  it("validation-failed membawa errors, galat lain tidak", async () => {
    const v = await (await fetch(app.url + "/validasi", { method: "POST" })).json();
    assert.deepEqual(v.errors, [{ field: "amount", message: "Harus bilangan bulat positif" }]);
    const f = await (await fetch(app.url + "/forbidden")).json();
    assert.equal("errors" in f, false);
  });

  it("MulterError lain memuat nama field yang bermasalah", async () => {
    const b = await (await fetch(app.url + "/multer-lain")).json();
    assert.equal(b.errors[0].field, "foto");
  });

  it("galat tak terduga tidak membocorkan pesan asli, hanya ke log", async () => {
    for (const jalur of ["/meledak", "/async-meledak"]) {
      const teks = await (await fetch(app.url + jalur)).text();
      assert.equal(teks.includes("rahasia-db-xyz"), false);
    }
    assert.equal(catat.mock.callCount(), 2);
    assert.equal(catat.mock.calls[0].arguments[0].message, "rahasia-db-xyz");
  });
});

describe("respons sudah mulai dikirim", () => {
  it("diteruskan ke penangan bawaan, tidak ditulis ulang", () => {
    const err = new Error("terlambat");
    const diteruskan = [];
    const res = { headersSent: true };
    errorHandler(err, {}, res, (e) => diteruskan.push(e));
    assert.deepEqual(diteruskan, [err]);
  });
});
