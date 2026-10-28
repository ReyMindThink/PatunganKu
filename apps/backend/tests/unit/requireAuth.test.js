import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { mulaiAplikasi } from "../helpers/http.js";
import { buatRequireAuth } from "../../src/middlewares/requireAuth.js";

const RAHASIA = "rahasia-uji-yang-panjangnya-lebih-dari-32-karakter";
const token = (isi, secret = RAHASIA, opsi = { algorithm: "HS256" }) => jwt.sign(isi, secret, opsi);
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

let server;
async function pasang(secret = RAHASIA) {
  const requireAuth = buatRequireAuth({ secret });
  return mulaiAplikasi((app) => {
    app.get("/saya", requireAuth, (req, res) => res.json({ user: req.user }));
  });
}

async function panggil(url, header) {
  const res = await fetch(url + "/saya", { headers: header === undefined ? {} : { authorization: header } });
  return { res, body: await res.json() };
}

describe("requireAuth", async () => {
  server = await pasang();
  after(() => server.tutup());

  it("token HS256 sah: req.user.id berupa number dari sub", async () => {
    const { res, body } = await panggil(server.url, "Bearer " + token({ sub: "42" }, RAHASIA, { algorithm: "HS256", expiresIn: "1h" }));
    assert.equal(res.status, 200);
    assert.deepEqual(body, { user: { id: 42 } });
  });

  it("nama skema tidak peka huruf besar", async () => {
    const { res } = await panggil(server.url, "bearer " + token({ sub: "42" }));
    assert.equal(res.status, 200);
  });

  it("tanpa header Authorization: 401 unauthorized problem+json", async () => {
    const { res, body } = await panggil(server.url);
    assert.equal(res.status, 401);
    assert.match(res.headers.get("content-type"), /^application\/problem\+json/);
    assert.equal(body.code, "unauthorized");
    assert.equal(body.status, 401);
  });

  it("skema bukan Bearer: 401", async () => {
    const { res, body } = await panggil(server.url, "Basic dXNlcjpwYXNz");
    assert.equal(res.status, 401);
    assert.equal(body.code, "unauthorized");
  });

  it("dua token dalam satu header: 401", async () => {
    const t = token({ sub: "42" });
    const { res } = await panggil(server.url, "Bearer " + t + " " + t);
    assert.equal(res.status, 401);
  });

  it("token rusak: 401", async () => {
    const { res, body } = await panggil(server.url, "Bearer abc.def.ghi");
    assert.equal(res.status, 401);
    assert.equal(body.code, "unauthorized");
  });

  it("token kedaluwarsa: 401", async () => {
    const { res } = await panggil(server.url, "Bearer " + token({ sub: "42" }, RAHASIA, { algorithm: "HS256", expiresIn: -10 }));
    assert.equal(res.status, 401);
  });

  it("ditandatangani rahasia lain: 401", async () => {
    const { res } = await panggil(server.url, "Bearer " + token({ sub: "42" }, "rahasia-lain-yang-juga-lebih-dari-32-karakter"));
    assert.equal(res.status, 401);
  });

  it("algoritma none: 401", async () => {
    const t = b64({ alg: "none", typ: "JWT" }) + "." + b64({ sub: "42" }) + ".";
    const { res } = await panggil(server.url, "Bearer " + t);
    assert.equal(res.status, 401);
  });

  it("HS512 dengan rahasia yang sama: 401 (algoritma dipaku HS256)", async () => {
    const { res } = await panggil(server.url, "Bearer " + token({ sub: "42" }, RAHASIA, { algorithm: "HS512" }));
    assert.equal(res.status, 401);
  });

  it("sub yang bukan id sah: 401", async () => {
    for (const sub of ["abc", "0", "007", "1.5", "-3", "2147483648", "", 42, null]) {
      const { res } = await panggil(server.url, "Bearer " + token({ sub }));
      assert.equal(res.status, 401, "sub " + JSON.stringify(sub) + " seharusnya ditolak");
    }
  });

  it("token tanpa sub: 401", async () => {
    const { res } = await panggil(server.url, "Bearer " + token({ nama: "x" }));
    assert.equal(res.status, 401);
  });

  it("rahasia berupa fungsi dibaca tiap permintaan", async () => {
    let sekarang = RAHASIA;
    const s = await pasang(() => sekarang);
    try {
      const t = token({ sub: "7" });
      assert.equal((await panggil(s.url, "Bearer " + t)).res.status, 200);
      sekarang = "rahasia-baru-yang-panjangnya-lebih-dari-32-karakter";
      assert.equal((await panggil(s.url, "Bearer " + t)).res.status, 401);
    } finally {
      await s.tutup();
    }
  });

  it("rahasia string kosong ditolak saat pembuatan", () => {
    assert.throws(() => buatRequireAuth({ secret: "" }), /secret/);
  });
});
