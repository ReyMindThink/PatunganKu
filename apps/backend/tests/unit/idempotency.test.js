import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mulaiAplikasi } from "../helpers/http.js";
import { buatDbPalsu } from "../helpers/fakeIdempotencyDb.js";
import { buatIdempotensi } from "../../src/utils/idempotency.js";
import { HttpError } from "../../src/utils/httpError.js";
import { IDEMPOTENSI } from "../../src/config/constants.js";

const K1 = "3f2b8c1e-5d4a-4b7e-9c3a-1a2b3c4d5e6f";
const K2 = "7a1d9e44-0b6c-4f2a-8d15-9e8f7a6b5c4d";
const T0 = 1_700_000_000_000;
const { TTL_MS, PROSES_KADALUWARSA_MS } = IDEMPOTENSI;
const sebagai = (req, res, next) => {
  if (req.headers["x-user"]) req.user = { id: Number(req.headers["x-user"]) };
  next();
};
const tunggu = async (kondisi) => {
  for (let i = 0; i < 200 && kondisi() === false; i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(kondisi(), "kondisi tidak tercapai");
};

describe("buatIdempotensi", async () => {
  const buka = [];
  after(() => Promise.all(buka.map((s) => s.tutup())));

  async function siap() {
    const jam = { t: T0 };
    const db = buatDbPalsu(jam);
    const stat = { jumlah: 0, gerbang: null, tunggu: 0, lempar: null, hasil: null };
    const { idempoten } = buatIdempotensi({ db, sekarang: () => jam.t });
    const aksi = async (req, tx) => {
      const n = ++stat.jumlah;
      const g = stat.gerbang;
      stat.gerbang = null;
      if (g) await g.janji;
      if (stat.tunggu > 0) await new Promise((r) => setTimeout(r, stat.tunggu));
      tx.bisnis.tambah({ n });
      if (stat.lempar) throw stat.lempar;
      if (stat.hasil) return stat.hasil();
      return { status: 201, body: { data: { n } } };
    };
    const server = await mulaiAplikasi((app) => {
      app.post("/aksi", sebagai, idempoten(aksi));
      app.put("/aksi", sebagai, idempoten(aksi));
      app.post("/aksi2", sebagai, idempoten(aksi));
      app.post("/p/:x", sebagai, idempoten(aksi));
      app.post("/tanpa-user", idempoten(aksi));
      app.post("/sidik", sebagai, idempoten(aksi, { sidik: () => "tetap" }));
    });
    buka.push(server);
    const gerbang = () => {
      let lepas;
      const janji = new Promise((r) => (lepas = r));
      stat.gerbang = { janji };
      return lepas;
    };
    const kirim = async (path, { key = K1, user = 1, metode = "POST", body = { a: 1 } } = {}) => {
      const headers = { "content-type": "application/json" };
      if (key) headers["idempotency-key"] = key;
      if (user) headers["x-user"] = String(user);
      const res = await fetch(server.url + path, { method: metode, headers, body: JSON.stringify(body) });
      const teks = await res.text();
      return { res, status: res.status, teks, body: teks === "" ? null : JSON.parse(teks) };
    };
    return { jam, db, stat, kirim, gerbang };
  }
  const replay = (r) => r.res.headers.get("idempotent-replay");

  it("tanpa header Idempotency-Key: 400 validation-failed, handler tidak jalan", async () => {
    const { kirim, stat } = await siap();
    const r = await kirim("/aksi", { key: null });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, "validation-failed");
    assert.equal(r.body.errors[0].field, "Idempotency-Key");
    assert.equal(stat.jumlah, 0);
  });

  it("kunci bukan UUID v4 (enam bentuk): 400, handler tidak jalan", async () => {
    const { kirim, stat } = await siap();
    const salah = ["abc", "bukan-uuid", "3f2b8c1e-5d4a-1b7e-9c3a-1a2b3c4d5e6f", "3f2b8c1e-5d4a-4b7e-cc3a-1a2b3c4d5e6f", "3f2b8c1e5d4a4b7e9c3a1a2b3c4d5e6f", K1 + "0"];
    for (const key of salah) {
      const r = await kirim("/aksi", { key });
      assert.equal(r.status, 400, key);
      assert.equal(r.body.errors[0].field, "Idempotency-Key", key);
    }
    assert.equal(stat.jumlah, 0);
  });

  it("pertama kali: 201 tanpa header replay; baris COMPLETED menyimpan status, badan, waktu", async () => {
    const { kirim, db } = await siap();
    const r = await kirim("/aksi");
    assert.equal(r.status, 201);
    assert.equal(replay(r), null);
    assert.deepEqual(r.body, { data: { n: 1 } });
    assert.equal(db.tabel.length, 1);
    const b = db.tabel[0];
    assert.equal(b.state, "COMPLETED");
    assert.equal(b.statusCode, 201);
    assert.equal(b.responseBody, JSON.stringify({ data: { n: 1 } }));
    assert.ok(b.completedAt instanceof Date);
    assert.equal(db.bisnis.length, 1);
  });

  it("ulang identik: respons tersimpan dengan Idempotent-Replay true, handler tidak jalan lagi", async () => {
    const { kirim, stat, db } = await siap();
    const a = await kirim("/aksi");
    const b = await kirim("/aksi");
    assert.equal(b.status, 201);
    assert.equal(replay(b), "true");
    assert.deepEqual(b.body, a.body);
    assert.equal(stat.jumlah, 1);
    assert.equal(db.bisnis.length, 1);
  });

  it("kunci huruf besar dinormalisasi ke huruf kecil", async () => {
    const { kirim, stat, db } = await siap();
    await kirim("/aksi");
    const b = await kirim("/aksi", { key: K1.toUpperCase() });
    assert.equal(replay(b), "true");
    assert.equal(stat.jumlah, 1);
    assert.equal(db.tabel[0].key, K1);
  });

  it("kunci sama tetapi isi, path, metode, atau query berbeda: 409 idempotency-key-reuse", async () => {
    const { kirim, stat } = await siap();
    await kirim("/aksi");
    const beda = [kirim("/aksi", { body: { a: 2 } }), kirim("/aksi2"), kirim("/aksi", { metode: "PUT" }), kirim("/aksi?x=1")];
    for (const r of await Promise.all(beda)) {
      assert.equal(r.status, 409);
      assert.equal(r.body.code, "idempotency-key-reuse");
      assert.match(r.res.headers.get("content-type"), /^application\/problem\+json/);
    }
    assert.equal(stat.jumlah, 1);
  });

  it("urutan field JSON dan objek bersarang yang berbeda tetap dianggap sama (replay)", async () => {
    const { kirim, stat } = await siap();
    await kirim("/aksi", { body: { a: 1, b: { c: 1, d: [1, { x: 1, y: 2 }] } } });
    const r = await kirim("/aksi", { body: { b: { d: [1, { y: 2, x: 1 }], c: 1 }, a: 1 } });
    assert.equal(replay(r), "true");
    assert.equal(stat.jumlah, 1);
  });

  it("pengguna berbeda dengan kunci sama: terpisah, handler jalan dua kali", async () => {
    const { kirim, stat, db } = await siap();
    await kirim("/aksi", { user: 1 });
    const r = await kirim("/aksi", { user: 2 });
    assert.equal(replay(r), null);
    assert.equal(stat.jumlah, 2);
    assert.equal(db.tabel.length, 2);
  });

  it("permintaan kedua saat pertama masih berjalan: 409 request-in-progress; sesudah selesai: replay", async () => {
    const { kirim, stat, gerbang } = await siap();
    const lepas = gerbang();
    const pertama = kirim("/aksi");
    await tunggu(() => stat.jumlah === 1);
    const kedua = await kirim("/aksi");
    assert.equal(kedua.status, 409);
    assert.equal(kedua.body.code, "request-in-progress");
    lepas();
    assert.equal((await pertama).status, 201);
    assert.equal(replay(await kirim("/aksi")), "true");
    assert.equal(stat.jumlah, 1);
  });

  it("lima permintaan paralel dengan kunci sama: aksi hanya sekali", async () => {
    const { kirim, stat, db } = await siap();
    stat.tunggu = 30;
    const semua = await Promise.all([1, 2, 3, 4, 5].map(() => kirim("/aksi")));
    assert.equal(stat.jumlah, 1);
    assert.equal(db.bisnis.length, 1);
    for (const r of semua) assert.ok(r.status === 201 || r.status === 409, "status " + r.status);
    assert.equal(semua.filter((r) => r.status === 201 && replay(r) === null).length, 1);
    for (const r of semua.filter((x) => x.status === 409)) assert.equal(r.body.code, "request-in-progress");
  });

  it("handler melempar HttpError: respons galat, penulisan batal, kunci dilepas, ulang dijalankan lagi", async () => {
    const { kirim, stat, db } = await siap();
    stat.lempar = new HttpError(409, "invalid-state", "Keadaan tidak cocok.");
    const r = await kirim("/aksi");
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "invalid-state");
    assert.equal(db.bisnis.length, 0);
    assert.equal(db.tabel.length, 0);
    stat.lempar = null;
    assert.equal((await kirim("/aksi")).status, 201);
    assert.equal(stat.jumlah, 2);
  });

  it("galat tak dikenal: 500 internal-error tanpa bocor teks, penulisan batal, kunci dilepas", async (t) => {
    t.mock.method(console, "error", () => {});
    const { kirim, stat, db } = await siap();
    stat.lempar = new Error("rahasia internal");
    const r = await kirim("/aksi");
    assert.equal(r.status, 500);
    assert.equal(r.body.code, "internal-error");
    assert.equal(r.teks.includes("rahasia internal"), false);
    assert.equal(db.tabel.length, 0);
    assert.equal(db.bisnis.length, 0);
  });

  it("hasil bukan 2xx, undefined, atau status string: 500, penulisan batal, kunci dilepas", async (t) => {
    t.mock.method(console, "error", () => {});
    const { kirim, stat, db } = await siap();
    for (const hasil of [() => ({ status: 400, body: {} }), () => undefined, () => ({ status: "201", body: {} })]) {
      stat.hasil = hasil;
      assert.equal((await kirim("/aksi")).status, 500);
      assert.equal(db.tabel.length, 0);
      assert.equal(db.bisnis.length, 0);
    }
  });

  it("204 tanpa isi: pertama kosong, ulang 204 kosong dengan header replay", async () => {
    const { kirim, stat, db } = await siap();
    stat.hasil = () => ({ status: 204 });
    const a = await kirim("/aksi");
    const b = await kirim("/aksi");
    assert.deepEqual([a.status, a.teks, replay(a)], [204, "", null]);
    assert.deepEqual([b.status, b.teks, replay(b)], [204, "", "true"]);
    assert.equal(db.tabel[0].responseBody, null);
    assert.equal(stat.jumlah, 1);
  });

  it("kedaluwarsa: tepat di TTL masih replay; TTL + 1 ms dijalankan baru dan baris diganti", async () => {
    const { kirim, stat, db, jam } = await siap();
    await kirim("/aksi");
    jam.t = T0 + TTL_MS;
    assert.equal(replay(await kirim("/aksi")), "true");
    jam.t = T0 + TTL_MS + 1;
    const r = await kirim("/aksi");
    assert.equal(replay(r), null);
    assert.equal(stat.jumlah, 2);
    assert.equal(db.tabel.length, 1);
    assert.equal(db.tabel[0].id, 2);
  });

  it("IN_PROGRESS basi: tepat di batas masih 409; lebih 1 ms diambil alih; yang lama tetap selesai", async () => {
    const { kirim, stat, jam, gerbang } = await siap();
    const lepas = gerbang();
    const pertama = kirim("/aksi");
    await tunggu(() => stat.jumlah === 1);
    jam.t = T0 + PROSES_KADALUWARSA_MS;
    assert.equal((await kirim("/aksi")).body.code, "request-in-progress");
    jam.t = T0 + PROSES_KADALUWARSA_MS + 1;
    const ketiga = await kirim("/aksi");
    assert.equal(ketiga.status, 201);
    assert.equal(ketiga.body.data.n, 2);
    lepas();
    assert.equal((await pertama).status, 201);
    assert.equal(stat.jumlah, 2);
  });

  it("tanpa req.user: 401 unauthorized", async () => {
    const { kirim, stat } = await siap();
    const r = await kirim("/tanpa-user", { user: null });
    assert.equal(r.status, 401);
    assert.equal(r.body.code, "unauthorized");
    assert.equal(stat.jumlah, 0);
  });

  it("opsi sidik kustom: isi berbeda tetap dianggap permintaan sama", async () => {
    const { kirim, stat } = await siap();
    await kirim("/sidik", { body: { a: 1 } });
    const r = await kirim("/sidik", { body: { a: 2 } });
    assert.equal(replay(r), "true");
    assert.equal(stat.jumlah, 1);
  });

  it("galat database non-bentrok saat reservasi: 500 setelah tepat 3 percobaan, handler tidak jalan", async (t) => {
    t.mock.method(console, "error", () => {});
    const { kirim, stat, db } = await siap();
    db.s.gagalCreate = true;
    const r = await kirim("/aksi");
    assert.equal(r.status, 500);
    assert.equal(db.s.create, 3);
    assert.equal(stat.jumlah, 0);
  });

  it("path lebih dari 300 karakter: 400 validation-failed", async () => {
    const { kirim, stat } = await siap();
    const r = await kirim("/p/" + "a".repeat(400));
    assert.equal(r.status, 400);
    assert.equal(r.body.code, "validation-failed");
    assert.equal(stat.jumlah, 0);
  });

  it("kunci berbeda dengan isi sama: dijalankan masing-masing", async () => {
    const { kirim, stat } = await siap();
    await kirim("/aksi", { key: K1 });
    const r = await kirim("/aksi", { key: K2 });
    assert.equal(replay(r), null);
    assert.equal(stat.jumlah, 2);
  });

  it("penandaan COMPLETED gagal: 500, penulisan bisnis ikut batal, kunci dilepas; setelah pulih berhasil", async (t) => {
    t.mock.method(console, "error", () => {});
    const { kirim, stat, db } = await siap();
    db.s.gagalUpdate = true;
    assert.equal((await kirim("/aksi")).status, 500);
    assert.equal(db.bisnis.length, 0);
    assert.equal(db.tabel.length, 0);
    db.s.gagalUpdate = false;
    assert.equal((await kirim("/aksi")).status, 201);
    assert.equal(db.bisnis.length, 1);
    assert.equal(stat.jumlah, 2);
  });

  it("dua pengambilalihan serentak atas IN_PROGRESS basi: hanya satu yang menjalankan aksi", async () => {
    const { kirim, stat, jam, gerbang, db } = await siap();
    const lepas = gerbang();
    const pertama = kirim("/aksi");
    await tunggu(() => stat.jumlah === 1);
    jam.t = T0 + PROSES_KADALUWARSA_MS + 1;
    stat.tunggu = 30;
    db.s.jedaBaca = 20;
    const dua = await Promise.all([kirim("/aksi"), kirim("/aksi")]);
    db.s.jedaBaca = 0;
    assert.equal(stat.jumlah, 2);
    assert.equal(dua.filter((r) => r.status === 201).length, 1);
    assert.equal(dua.filter((r) => r.status === 409 && r.body.code === "request-in-progress").length, 1);
    lepas();
    await pertama;
  });

  it("permintaan lama yang gagal tidak menghapus baris COMPLETED milik pengambil alih", async () => {
    const { kirim, stat, jam, gerbang, db } = await siap();
    const lepas = gerbang();
    const pertama = kirim("/aksi");
    await tunggu(() => stat.jumlah === 1);
    jam.t = T0 + PROSES_KADALUWARSA_MS + 1;
    assert.equal((await kirim("/aksi")).status, 201);
    stat.lempar = new HttpError(409, "invalid-state", "Kalah.");
    lepas();
    assert.equal((await pertama).status, 409);
    assert.equal(db.tabel.length, 1);
    assert.equal(db.tabel[0].state, "COMPLETED");
    assert.equal(replay(await kirim("/aksi")), "true");
  });
});
