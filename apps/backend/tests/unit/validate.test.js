// validate(): validasi body, params, dan query, galat lewat errorHandler (K42).
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { validate } from "../../src/middlewares/validate.js";
import { idParam } from "../../src/validators/common.js";
import { mulaiAplikasi } from "../helpers/http.js";

const bodySkema = z.object({
  amount: z.number().int().positive(),
  note: z.string().trim().max(20).optional(),
});

const querySkema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

let app;

beforeEach(async () => {
  app = await mulaiAplikasi((a) => {
    a.post("/lama", validate(bodySkema), (req, res) => res.json({ body: req.body, valid: req.valid }));
    a.post(
      "/g/:groupId/t",
      validate({ params: idParam("groupId"), query: querySkema, body: bodySkema }),
      (req, res) => res.json({ valid: req.valid, body: req.body }),
    );
    a.get("/g/:groupId", validate({ params: idParam("groupId") }), (req, res) =>
      res.json({ valid: req.valid }),
    );
  });
});

afterEach(async () => {
  await app.tutup();
});

const kirimJson = (url, body) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("validate", () => {
  it("bentuk lama validate(skema) memeriksa body dan mengganti req.body", async () => {
    const res = await kirimJson(app.url + "/lama", { amount: 5000, note: "  halo  " });
    assert.equal(res.status, 200);
    const b = await res.json();
    assert.deepEqual(b.body, { amount: 5000, note: "halo" });
    assert.deepEqual(b.valid, { body: { amount: 5000, note: "halo" } });
  });

  it("body tidak valid menjadi 400 validation-failed dengan errors", async () => {
    const res = await kirimJson(app.url + "/lama", { amount: -1 });
    assert.equal(res.status, 400);
    assert.match(res.headers.get("content-type"), /^application\/problem\+json/);
    const b = await res.json();
    assert.equal(b.code, "validation-failed");
    assert.equal(b.errors.length, 1);
    assert.equal(b.errors[0].field, "amount");
    assert.equal(typeof b.errors[0].message, "string");
  });

  it("body kosong diperlakukan sebagai objek kosong", async () => {
    const res = await fetch(app.url + "/lama", { method: "POST" });
    assert.equal(res.status, 400);
    const b = await res.json();
    assert.equal(b.errors[0].field, "amount");
  });

  it("pesan galat memakai bahasa Indonesia", async () => {
    const res = await kirimJson(app.url + "/lama", { amount: "bukan angka" });
    const b = await res.json();
    assert.match(b.errors[0].message, /diharapkan/);
  });

  it("params, query, dan body diperiksa bersama, hasilnya di req.valid", async () => {
    const res = await kirimJson(app.url + "/g/7/t?limit=50", { amount: 100 });
    assert.equal(res.status, 200);
    const b = await res.json();
    assert.deepEqual(b.valid, { params: { groupId: 7 }, query: { limit: 50 }, body: { amount: 100 } });
  });

  it("query memakai nilai bawaan dan req.query tidak ditimpa", async () => {
    const res = await kirimJson(app.url + "/g/7/t", { amount: 100 });
    const b = await res.json();
    assert.equal(b.valid.query.limit, 20);
  });

  it("galat dari semua bagian dikumpulkan dalam satu respons", async () => {
    const res = await kirimJson(app.url + "/g/abc/t?limit=500", { amount: 0 });
    assert.equal(res.status, 400);
    const b = await res.json();
    assert.deepEqual(b.errors.map((e) => e.field).sort(), ["amount", "groupId", "limit"]);
  });
});

describe("idParam", () => {
  const sah = [
    ["1", 1],
    ["42", 42],
    ["2147483647", 2147483647],
  ];
  const tidakSah = ["0", "-1", "abc", "1.5", "007", "2147483648", "99999999999", " 5", "5 ", "1e3", ""];

  for (const [teks, angka] of sah) {
    it("menerima " + teks, async () => {
      const res = await fetch(app.url + "/g/" + teks);
      assert.equal(res.status, 200);
      assert.equal((await res.json()).valid.params.groupId, angka);
    });
  }

  for (const teks of tidakSah.filter((t) => t.length > 0)) {
    it("menolak " + JSON.stringify(teks), async () => {
      const res = await fetch(app.url + "/g/" + encodeURIComponent(teks));
      assert.equal(res.status, 400);
      assert.equal((await res.json()).errors[0].field, "groupId");
    });
  }
});
