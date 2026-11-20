import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { mulaiAplikasi } from "../helpers/http.js";
import { validate } from "../../src/middlewares/validate.js";
import { halaman } from "../../src/utils/respond.js";
import { paginasiQuery } from "../../src/validators/common.js";
import { ambilHalaman, bacaKursor, kodeKursor } from "../../src/utils/pagination.js";

const skemaKursor = z.object({ id: z.number().int().positive() });
const buatKursor = (baris) => ({ id: baris.id });

// Penyimpanan palsu terurut menurun menurut id; ambil() meniru keyset "id lebih kecil dari kursor".
function buatSimpanan(jumlah) {
  const baris = Array.from({ length: jumlah }, (_, i) => ({ id: jumlah - i }));
  const panggilan = [];
  const ambil = async ({ take, kursor }) => {
    panggilan.push({ take, kursor });
    const sisa = kursor === null ? baris : baris.filter((b) => b.id < kursor.id);
    return sisa.slice(0, take);
  };
  return { baris, panggilan, ambil };
}

const halamanKe = (s, limit, kursor) => ambilHalaman({ limit, kursor, skemaKursor, ambil: s.ambil, buatKursor });
const ids = (hasil) => hasil.data.map((b) => b.id);

describe("kursor", () => {
  it("kode dan baca bolak-balik", () => {
    const teks = kodeKursor({ id: 123 });
    assert.match(teks, /^[A-Za-z0-9_-]+$/);
    assert.deepEqual(bacaKursor(teks, skemaKursor), { id: 123 });
  });

  it("kursor rusak, salah bentuk, atau terlalu panjang: 400 validation-failed field cursor", () => {
    const b64 = (teks) => Buffer.from(teks).toString("base64url");
    const rusak = [
      "",
      "abc",
      "a b",
      "%%%",
      b64("bukan json"),
      b64("[]"),
      b64("null"),
      b64(JSON.stringify({ id: "x" })),
      b64(JSON.stringify({ id: 0 })),
      b64(JSON.stringify({ id: 1.5 })),
      "A".repeat(301),
      undefined,
      42,
    ];
    for (const teks of rusak) {
      assert.throws(
        () => bacaKursor(teks, skemaKursor),
        (e) => e.status === 400 && e.code === "validation-failed" && e.errors[0].field === "cursor",
        "kursor " + JSON.stringify(teks) + " seharusnya ditolak",
      );
    }
  });
});

describe("ambilHalaman", () => {
  it("tiga halaman: hasMore, nextCursor, urutan terbaru dulu, tiap id muncul sekali", async () => {
    const s = buatSimpanan(25);
    const p1 = await halamanKe(s, 10);
    assert.equal(p1.data.length, 10);
    assert.equal(p1.hasMore, true);
    assert.equal(typeof p1.nextCursor, "string");
    const p2 = await halamanKe(s, 10, p1.nextCursor);
    assert.equal(p2.hasMore, true);
    const p3 = await halamanKe(s, 10, p2.nextCursor);
    assert.equal(p3.data.length, 5);
    assert.equal(p3.hasMore, false);
    assert.equal(p3.nextCursor, null);
    assert.deepEqual([...ids(p1), ...ids(p2), ...ids(p3)], s.baris.map((b) => b.id));
  });

  it("tepat sejumlah limit: hasMore false; satu lebih banyak: hasMore true dan data dipotong ke limit", async () => {
    const tepat = await halamanKe(buatSimpanan(10), 10);
    assert.equal(tepat.hasMore, false);
    assert.equal(tepat.nextCursor, null);
    assert.equal(tepat.data.length, 10);
    const lebih = await halamanKe(buatSimpanan(11), 10);
    assert.equal(lebih.hasMore, true);
    assert.equal(lebih.data.length, 10);
    assert.equal(bacaKursor(lebih.nextCursor, skemaKursor).id, lebih.data[9].id);
  });

  it("daftar kosong: data kosong, hasMore false, nextCursor null", async () => {
    const hasil = await halamanKe(buatSimpanan(0), 20);
    assert.deepEqual(hasil, { data: [], nextCursor: null, hasMore: false });
  });

  it("meminta limit + 1 baris, kursor null pada halaman pertama dan terurai pada berikutnya", async () => {
    const s = buatSimpanan(30);
    const p1 = await halamanKe(s, 10);
    await halamanKe(s, 10, p1.nextCursor);
    assert.deepEqual(s.panggilan[0], { take: 11, kursor: null });
    assert.deepEqual(s.panggilan[1], { take: 11, kursor: { id: p1.data[9].id } });
  });

  it("baris baru di antara dua halaman tidak menggeser hasil", async () => {
    const s = buatSimpanan(25);
    const p1 = await halamanKe(s, 10);
    s.baris.unshift({ id: 28 }, { id: 27 }, { id: 26 });
    const p2 = await halamanKe(s, 10, p1.nextCursor);
    const p3 = await halamanKe(s, 10, p2.nextCursor);
    assert.deepEqual([...ids(p1), ...ids(p2), ...ids(p3)], Array.from({ length: 25 }, (_, i) => 25 - i));
    assert.equal(ids(await halamanKe(s, 10))[0], 28);
  });

  it("kursor tidak valid ditolak sebelum database disentuh", async () => {
    const s = buatSimpanan(5);
    await assert.rejects(halamanKe(s, 10, "abc"), (e) => e.status === 400 && e.errors[0].field === "cursor");
    assert.equal(s.panggilan.length, 0);
  });

  it("limit yang bukan bilangan bulat positif adalah kesalahan pemrogram", async () => {
    const s = buatSimpanan(5);
    for (const limit of [0, -1, 1.5, "10", undefined]) {
      await assert.rejects(halamanKe(s, limit), /limit/);
    }
  });
});

describe("query limit dan cursor lewat HTTP", async () => {
  const s = buatSimpanan(25);
  const server = await mulaiAplikasi((app) => {
    app.get("/daftar", validate({ query: paginasiQuery }), async (req, res) => {
      const { limit, cursor } = req.valid.query;
      const hasil = await ambilHalaman({ limit, kursor: cursor, skemaKursor, ambil: s.ambil, buatKursor });
      halaman(res, hasil.data, hasil);
    });
  });
  after(() => server.tutup());

  const minta = async (query) => {
    const res = await fetch(server.url + "/daftar" + query);
    return { res, body: await res.json() };
  };

  it("tanpa query: limit bawaan 20 dan bentuk { data, page }", async () => {
    const { res, body } = await minta("");
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(body).sort(), ["data", "page"]);
    assert.deepEqual(Object.keys(body.page).sort(), ["hasMore", "nextCursor"]);
    assert.equal(body.data.length, 20);
    assert.equal(body.page.hasMore, true);
  });

  it("limit 5 dan limit 100 (batas) diterima", async () => {
    assert.equal((await minta("?limit=5")).body.data.length, 5);
    const penuh = await minta("?limit=100");
    assert.equal(penuh.res.status, 200);
    assert.equal(penuh.body.data.length, 25);
    assert.equal(penuh.body.page.hasMore, false);
    assert.equal(penuh.body.page.nextCursor, null);
  });

  it("limit tidak sah ditolak 400 validation-failed, termasuk di atas 100 (tidak dipotong)", async () => {
    for (const nilai of ["0", "101", "1000", "abc", "1.5", "-1", "", "007", "5abc"]) {
      const { res, body } = await minta("?limit=" + nilai);
      assert.equal(res.status, 400, "limit=" + nilai);
      assert.equal(body.code, "validation-failed", "limit=" + nilai);
      assert.equal(body.errors[0].field, "limit", "limit=" + nilai);
    }
  });

  it("kursor rusak: 400 validation-failed field cursor", async () => {
    const { res, body } = await minta("?cursor=abc");
    assert.equal(res.status, 400);
    assert.equal(body.errors[0].field, "cursor");
    assert.equal((await minta("?cursor=")).res.status, 400);
  });

  it("mengikuti nextCursor sampai habis: 25 id berbeda, terbaru dulu", async () => {
    const semua = [];
    let query = "?limit=10";
    for (let i = 0; i < 5; i++) {
      const { body } = await minta(query);
      semua.push(...body.data.map((b) => b.id));
      if (body.page.hasMore === false) break;
      query = "?limit=10&cursor=" + encodeURIComponent(body.page.nextCursor);
    }
    assert.deepEqual(semua, Array.from({ length: 25 }, (_, i) => 25 - i));
  });
});
