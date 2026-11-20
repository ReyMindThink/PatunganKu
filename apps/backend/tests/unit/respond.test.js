// Pembungkus respons sukses (api-contract 5.1).
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { dibuat, halaman, kirim, kosong } from "../../src/utils/respond.js";
import { mulaiAplikasi } from "../helpers/http.js";

let app;

beforeEach(async () => {
  app = await mulaiAplikasi((a) => {
    a.get("/satu", (req, res) => kirim(res, { id: 1 }));
    a.post("/baru", (req, res) => dibuat(res, { id: 2 }));
    a.delete("/hapus", (req, res) => kosong(res));
    a.get("/daftar", (req, res) => halaman(res, [1, 2], { nextCursor: "abc", hasMore: true }));
    a.get("/habis", (req, res) => halaman(res, [3], { nextCursor: "sisa", hasMore: false }));
    a.get("/kosong", (req, res) => halaman(res, []));
  });
});

afterEach(async () => {
  await app.tutup();
});

describe("respons sukses", () => {
  it("kirim membungkus objek di data dengan status 200", async () => {
    const res = await fetch(app.url + "/satu");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { data: { id: 1 } });
  });

  it("dibuat memakai status 201", async () => {
    const res = await fetch(app.url + "/baru", { method: "POST" });
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { data: { id: 2 } });
  });

  it("kosong memakai 204 tanpa isi", async () => {
    const res = await fetch(app.url + "/hapus", { method: "DELETE" });
    assert.equal(res.status, 204);
    assert.equal(await res.text(), "");
  });

  it("halaman memuat page dengan nextCursor dan hasMore", async () => {
    const res = await fetch(app.url + "/daftar");
    assert.deepEqual(await res.json(), { data: [1, 2], page: { nextCursor: "abc", hasMore: true } });
  });

  it("tanpa halaman lagi, nextCursor dipaksa null", async () => {
    const res = await fetch(app.url + "/habis");
    assert.deepEqual(await res.json(), { data: [3], page: { nextCursor: null, hasMore: false } });
  });

  it("halaman tanpa opsi berarti habis", async () => {
    const res = await fetch(app.url + "/kosong");
    assert.deepEqual(await res.json(), { data: [], page: { nextCursor: null, hasMore: false } });
  });
});
