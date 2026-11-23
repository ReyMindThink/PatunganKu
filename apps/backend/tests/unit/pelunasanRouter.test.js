import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { mulaiAplikasi } from "../helpers/http.js";
import { buatAkses } from "../../src/middlewares/access.js";
import { buatRequireAuth } from "../../src/middlewares/requireAuth.js";
import { buatRouterPelunasan } from "../../src/routes/pelunasan.router.js";

const SECRET = "rahasia-uji-router-pelunasan-yang-cukup-panjang";
const token = (id) => jwt.sign({ sub: String(id) }, SECRET, { algorithm: "HS256", expiresIn: "1h" });

// Grup 7: 1 OWNER ACTIVE, 5 MEMBER ACTIVE, 2 LEFT, 3 REMOVED; 4 bukan anggota. Grup 8: 1 ACTIVE.
const tabel = {
  "7:1": { role: "OWNER", status: "ACTIVE" },
  "7:5": { role: "MEMBER", status: "ACTIVE" },
  "7:2": { role: "MEMBER", status: "LEFT" },
  "7:3": { role: "MEMBER", status: "REMOVED" },
  "8:1": { role: "OWNER", status: "ACTIVE" },
};
const dbPalsu = { groupMember: { findUnique: async ({ where }) => tabel[where.groupId_userId.groupId + ":" + where.groupId_userId.userId] ?? null } };
const TX = { tx: true };

describe("router pelunasan", async () => {
  const panggilan = [];
  let dibungkus = 0;
  const layanan = new Proxy({}, {
    get: (_, nama) => async (...args) => {
      panggilan.push({ nama, args });
      if (nama === "bukti") return { buffer: Buffer.from("isi-bukti"), tipe: "image/png" };
      return nama === "daftar" ? { data: [{ id: 1 }], nextCursor: "kur", hasMore: true } : { nama };
    },
  });
  const idempotenPalsu = (fn) => {
    dibungkus += 1;
    return async (req, res) => {
      const hasil = await fn(req, TX);
      return res.status(hasil.status).json(hasil.body);
    };
  };
  const router = buatRouterPelunasan({ layanan, requireAuth: buatRequireAuth({ secret: SECRET }), requireMember: buatAkses({ db: dbPalsu }).requireMember, idempoten: idempotenPalsu });
  const server = await mulaiAplikasi((app) => app.use("/api/groups", router));
  after(() => server.tutup());

  const minta = async (metode, path, { userId, body, form } = {}) => {
    const headers = {};
    if (Number.isInteger(userId)) headers.authorization = "Bearer " + token(userId);
    let isi;
    if (form) isi = form;
    else if ((body === undefined) === false) {
      headers["content-type"] = "application/json";
      isi = JSON.stringify(body);
    }
    const res = await fetch(server.url + "/api/groups" + path, { method: metode, headers, body: isi });
    const teks = await res.text();
    return { status: res.status, body: teks === "" ? null : JSON.parse(teks) };
  };
  const rute = router.stack.filter((l) => l.route).flatMap((l) => Object.keys(l.route.methods).map((m) => m + " " + l.route.path));
  const formDari = (medan, berkas) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(medan)) f.append(k, v);
    if (berkas) f.append(berkas.nama, new Blob([berkas.isi]), "bukti.jpg");
    return f;
  };
  const isiSah = { receiverId: "5", amount: "10000", methodType: "CASH" };
  const ctx = (userId, groupId = 7, role = "MEMBER") => ({ userId, groupId, role });

  it("tujuh rute; hanya kirim dan konfirmasi yang dibungkus idempotensi", () => {
    assert.deepEqual(rute, [
      "post /:groupId/payments",
      "get /:groupId/payments",
      "get /:groupId/payments/:paymentId",
      "get /:groupId/payments/:paymentId/proof",
      "post /:groupId/payments/:paymentId/confirm",
      "post /:groupId/payments/:paymentId/reject",
      "post /:groupId/payments/:paymentId/cancel",
    ]);
    assert.equal(dibungkus, 2);
  });

  it("tanpa token 401 pada semua rute dan layanan tidak dipanggil", async () => {
    panggilan.length = 0;
    const semua = [["POST", "/7/payments", { body: isiSah }], ["GET", "/7/payments"], ["GET", "/7/payments/1"], ["GET", "/7/payments/1/proof"], ["POST", "/7/payments/1/confirm"], ["POST", "/7/payments/1/reject"], ["POST", "/7/payments/1/cancel"]];
    for (const [m, p, o] of semua) assert.equal((await minta(m, p, o)).status, 401, m + " " + p);
    assert.deepEqual(panggilan, []);
  });

  it("akses: non-anggota dan grup tak ada 403 pada semua rute; ACTIVE, LEFT, REMOVED boleh", async () => {
    panggilan.length = 0;
    for (const grup of [7, 99]) {
      const user = grup === 7 ? 4 : 1;
      for (const [m, p] of [["POST", "/" + grup + "/payments"], ["GET", "/" + grup + "/payments"], ["GET", "/" + grup + "/payments/1"], ["GET", "/" + grup + "/payments/1/proof"], ["POST", "/" + grup + "/payments/1/confirm"], ["POST", "/" + grup + "/payments/1/reject"], ["POST", "/" + grup + "/payments/1/cancel"]]) {
        assert.equal((await minta(m, p, { userId: user, body: m === "POST" ? isiSah : undefined })).status, 403, m + " " + p);
      }
    }
    assert.deepEqual(panggilan, []);
    for (const userId of [1, 5, 2, 3]) assert.equal((await minta("GET", "/7/payments/1", { userId })).status, 200, "pengguna " + userId);
  });

  it("kirim (JSON): 201, badan dibersihkan, tx dari idempotensi dan ctx dari token", async () => {
    panggilan.length = 0;
    const h = await minta("POST", "/7/payments", { userId: 5, body: { receiverId: 1, amount: 10000, methodType: "CASH", note: " halo " } });
    assert.equal(h.status, 201);
    assert.deepEqual(h.body, { data: { nama: "kirim" } });
    assert.deepEqual(panggilan, [{ nama: "kirim", args: [TX, ctx(5, 7, "MEMBER"), { receiverId: 1, amount: 10000, methodType: "CASH", note: "halo" }, undefined] }]);
  });

  it("kirim (multipart): field teks menjadi number, catatan kosong dibuang", async () => {
    panggilan.length = 0;
    const h = await minta("POST", "/7/payments", { userId: 1, form: formDari({ ...isiSah, note: "" }) });
    assert.equal(h.status, 201);
    // note kosong menjadi undefined (kuncinya ada); layanan memakai note ?? null.
    assert.deepEqual(panggilan, [{ nama: "kirim", args: [TX, ctx(1, 7, "OWNER"), { receiverId: 5, amount: 10000, methodType: "CASH", note: undefined }, undefined] }]);
  });

  it("kirim: badan tidak sah 400 dengan nama field; layanan tidak dipanggil", async () => {
    panggilan.length = 0;
    const kasus = [
      [{ ...isiSah, methodType: "BANK" }, "methodId"],
      [{ ...isiSah, methodType: "BANK", methodId: "0" }, "methodId"],
      [{ ...isiSah, methodType: "QRIS" }, "methodType"],
      [{ ...isiSah, methodType: "CASH", methodId: "3" }, "body"],
      [{ ...isiSah, onBehalfOfFund: "true" }, "body"],
      [{ amount: "10000", methodType: "CASH" }, "receiverId"],
      [{ ...isiSah, amount: "0" }, "amount"],
      [{ ...isiSah, receiverId: "abc" }, "receiverId"],
    ];
    for (const [badan, field] of kasus) {
      const h = await minta("POST", "/7/payments", { userId: 1, form: formDari(badan) });
      assert.equal(h.status, 400, JSON.stringify(badan));
      assert.equal(h.body.code, "validation-failed");
      assert.equal(h.body.errors.some((e) => e.field === field), true, JSON.stringify(badan) + " " + JSON.stringify(h.body.errors));
    }
    assert.deepEqual(panggilan, []);
  });

  it("kirim: berkas bukti pada tunai ditolak 400 (field proof); berkas di field lain juga ditolak", async () => {
    panggilan.length = 0;
    const a = await minta("POST", "/7/payments", { userId: 1, form: formDari(isiSah, { nama: "proof", isi: "x" }) });
    assert.equal(a.status, 400);
    assert.equal(a.body.errors.some((e) => e.field === "proof" && /tidak memakai bukti/.test(e.message)), true);
    const b = await minta("POST", "/7/payments", { userId: 1, form: formDari(isiSah, { nama: "lain", isi: "x" }) });
    assert.equal(b.status, 400);
    assert.deepEqual(panggilan, []);
  });

  const JPEG_BYTE = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("isi-gambar-bukti")]);
  const isiBank = { ...isiSah, methodType: "BANK", methodId: "21" };
  const sha = (b) => createHash("sha256").update(b).digest("hex");

  it("kirim BANK dan EWALLET (multipart): berkas diteruskan, hash berkas masuk badan (sidik idempotensi), metodeId number", async () => {
    for (const jenis of ["BANK", "EWALLET"]) {
      panggilan.length = 0;
      const h = await minta("POST", "/7/payments", { userId: 5, form: formDari({ ...isiBank, methodType: jenis, note: " x " }, { nama: "proof", isi: JPEG_BYTE }) });
      assert.equal(h.status, 201, jenis);
      assert.equal(panggilan.length, 1);
      const [tx, c, badan, bukti] = panggilan[0].args;
      assert.deepEqual([tx, c], [TX, ctx(5, 7, "MEMBER")]);
      assert.deepEqual(badan, { receiverId: 5, amount: 10000, methodType: jenis, methodId: 21, note: "x", proofSha256: sha(JPEG_BYTE) });
      assert.equal(Buffer.isBuffer(bukti.buffer), true);
      assert.equal(bukti.buffer.equals(JPEG_BYTE), true);
    }
  });

  it("hash berkas berbeda untuk berkas berbeda (kunci idempotensi yang sama tidak dapat dipakai ulang untuk berkas lain)", async () => {
    panggilan.length = 0;
    await minta("POST", "/7/payments", { userId: 5, form: formDari(isiBank, { nama: "proof", isi: JPEG_BYTE }) });
    await minta("POST", "/7/payments", { userId: 5, form: formDari(isiBank, { nama: "proof", isi: Buffer.concat([JPEG_BYTE, Buffer.from("x")]) }) });
    assert.equal(panggilan.length, 2);
    assert.notEqual(panggilan[0].args[2].proofSha256, panggilan[1].args[2].proofSha256);
  });

  it("BANK dan EWALLET tanpa berkas: 400 di field proof dengan pesan wajib; layanan tidak dipanggil", async () => {
    panggilan.length = 0;
    for (const jenis of ["BANK", "EWALLET"]) {
      const h = await minta("POST", "/7/payments", { userId: 5, form: formDari({ ...isiBank, methodType: jenis }) });
      assert.equal(h.status, 400, jenis);
      assert.equal(h.body.errors.some((e) => e.field === "proof" && /wajib/.test(e.message)), true);
    }
    assert.deepEqual(panggilan, []);
  });

  it("BANK dengan badan tidak sah dan berkas: kesalahan badan lebih dulu (methodId), tanpa memanggil layanan", async () => {
    panggilan.length = 0;
    const h = await minta("POST", "/7/payments", { userId: 5, form: formDari({ ...isiSah, methodType: "BANK" }, { nama: "proof", isi: JPEG_BYTE }) });
    assert.equal(h.status, 400);
    assert.equal(h.body.errors.some((e) => e.field === "methodId"), true);
    assert.deepEqual(panggilan, []);
  });

  it("berkas lebih dari 5 MB: 413 payload-too-large dari multer", async () => {
    panggilan.length = 0;
    const besar = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(5 * 1024 * 1024 + 1)]);
    const h = await minta("POST", "/7/payments", { userId: 5, form: formDari(isiBank, { nama: "proof", isi: besar }) });
    assert.equal(h.status, 413);
    assert.equal(h.body.code, "payload-too-large");
    assert.deepEqual(panggilan, []);
  });

  it("GET bukti: isi biner, tipe dari layanan, tidak boleh disimpan cache, nosniff; id tak sah 400", async () => {
    panggilan.length = 0;
    const res = await fetch(server.url + "/api/groups/7/payments/777/proof", { headers: { authorization: "Bearer " + token(2) } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(Buffer.from(await res.arrayBuffer()).toString(), "isi-bukti");
    assert.deepEqual(panggilan, [{ nama: "bukti", args: [ctx(2), 777] }]);
    for (const id of ["abc", "0", "1.5"]) assert.equal((await minta("GET", "/7/payments/" + id + "/proof", { userId: 2 })).status, 400, id);
  });

  it("daftar: query tervalidasi, respons memuat page; role dan limit tidak sah 400", async () => {
    panggilan.length = 0;
    const h = await minta("GET", "/7/payments?role=sent&status=PENDING&limit=5&cursor=abc", { userId: 5 });
    assert.equal(h.status, 200);
    assert.deepEqual(h.body, { data: [{ id: 1 }], page: { nextCursor: "kur", hasMore: true } });
    assert.deepEqual(panggilan, [{ nama: "daftar", args: [ctx(5), { limit: 5, cursor: "abc", role: "sent", status: "PENDING" }] }]);
    panggilan.length = 0;
    assert.equal((await minta("GET", "/7/payments", { userId: 5 })).status, 200);
    assert.deepEqual(panggilan[0].args[1], { limit: 20 });
    for (const q of ["role=all", "status=DONE", "limit=0", "limit=101"]) assert.equal((await minta("GET", "/7/payments?" + q, { userId: 5 })).status, 400, q);
  });

  it("detail: paymentId menjadi number dan id tak sah 400", async () => {
    panggilan.length = 0;
    const h = await minta("GET", "/7/payments/801", { userId: 2 });
    assert.equal(h.status, 200);
    assert.deepEqual(h.body, { data: { nama: "detail" } });
    assert.deepEqual(panggilan, [{ nama: "detail", args: [ctx(2), 801] }]);
    for (const id of ["abc", "0", "1.5", "-1"]) assert.equal((await minta("GET", "/7/payments/" + id, { userId: 2 })).status, 400, id);
  });

  it("konfirmasi: tx dari idempotensi, ctx, paymentId number", async () => {
    panggilan.length = 0;
    const h = await minta("POST", "/7/payments/801/confirm", { userId: 1 });
    assert.equal(h.status, 200);
    assert.deepEqual(h.body, { data: { nama: "konfirmasi" } });
    assert.deepEqual(panggilan, [{ nama: "konfirmasi", args: [TX, ctx(1, 7, "OWNER"), 801] }]);
    assert.equal((await minta("POST", "/7/payments/abc/confirm", { userId: 1 })).status, 400);
  });

  it("tolak: alasan dibersihkan, tanpa badan menjadi objek kosong, kunci asing 400, tanpa tx", async () => {
    panggilan.length = 0;
    assert.equal((await minta("POST", "/7/payments/801/reject", { userId: 1, body: { reason: " salah " } })).status, 200);
    assert.deepEqual(panggilan.pop(), { nama: "tolak", args: [ctx(1, 7, "OWNER"), 801, { reason: "salah" }] });
    assert.equal((await minta("POST", "/7/payments/801/reject", { userId: 1 })).status, 200);
    assert.deepEqual(panggilan.pop(), { nama: "tolak", args: [ctx(1, 7, "OWNER"), 801, {}] });
    assert.equal((await minta("POST", "/7/payments/801/reject", { userId: 1, body: { foo: 1 } })).status, 400);
    assert.equal((await minta("POST", "/7/payments/801/reject", { userId: 1, body: { reason: "x".repeat(501) } })).status, 400);
    assert.deepEqual(panggilan, []);
  });

  it("batal: ctx dan paymentId number, tanpa tx", async () => {
    panggilan.length = 0;
    const h = await minta("POST", "/7/payments/801/cancel", { userId: 2 });
    assert.equal(h.status, 200);
    assert.deepEqual(h.body, { data: { nama: "batal" } });
    assert.deepEqual(panggilan, [{ nama: "batal", args: [ctx(2), 801] }]);
    assert.equal((await minta("POST", "/7/payments/0/cancel", { userId: 2 })).status, 400);
  });

  it("ctx memakai grup dari path (grup 8)", async () => {
    panggilan.length = 0;
    await minta("GET", "/8/payments/9", { userId: 1 });
    assert.deepEqual(panggilan, [{ nama: "detail", args: [ctx(1, 8, "OWNER"), 9] }]);
  });
});
