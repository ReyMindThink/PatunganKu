import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mulaiAplikasi } from "../helpers/http.js";
import { buatPembatas } from "../../src/middlewares/rateLimit.js";

const DETIK = 1000;
const MENIT = 60 * DETIK;

// Memasang pembatas pada GET /p dan POST /masuk, dengan jam palsu yang digerakkan tes.
async function pasang(opsi) {
  const jam = { t: 1_000_000 };
  const pembatas = buatPembatas({ sekarang: () => jam.t, ...opsi });
  const server = await mulaiAplikasi((app) => {
    app.get("/p", pembatas, (req, res) => res.json({ ok: true }));
    app.post("/masuk", pembatas, (req, res) => res.json({ ok: true }));
  });
  const minta = async (headers = {}) => {
    const res = await fetch(server.url + "/p", { headers });
    return { res, body: await res.json() };
  };
  return { jam, server, minta };
}

describe("buatPembatas", async () => {
  const buka = [];
  after(() => Promise.all(buka.map((s) => s.tutup())));
  const siap = async (opsi) => {
    const x = await pasang(opsi);
    buka.push(x.server);
    return x;
  };

  it("batas permintaan lolos, berikutnya 429 rate-limited problem+json dengan Retry-After", async () => {
    const { minta } = await siap({ batas: 3, jendelaMs: MENIT, kunci: () => "k" });
    for (let i = 0; i < 3; i++) assert.equal((await minta()).res.status, 200, "permintaan " + (i + 1));
    const { res, body } = await minta();
    assert.equal(res.status, 429);
    assert.match(res.headers.get("content-type"), /^application\/problem\+json/);
    assert.equal(body.code, "rate-limited");
    assert.equal(body.status, 429);
    assert.equal(res.headers.get("retry-after"), "60");
    assert.match(res.headers.get("retry-after"), /^[0-9]+$/);
  });

  it("Retry-After menyusut mengikuti waktu, dibulatkan ke atas, minimal 1", async () => {
    const { jam, minta } = await siap({ batas: 1, jendelaMs: MENIT, kunci: () => "k" });
    assert.equal((await minta()).res.status, 200);
    jam.t += 20 * DETIK;
    assert.equal((await minta()).res.headers.get("retry-after"), "40");
    jam.t += 39 * DETIK + 500;
    assert.equal((await minta()).res.headers.get("retry-after"), "1");
  });

  it("sisa waktu pecahan dibulatkan ke atas: 40,5 detik menjadi 41", async () => {
    const { jam, minta } = await siap({ batas: 1, jendelaMs: MENIT, kunci: () => "k" });
    assert.equal((await minta()).res.status, 200);
    jam.t += 19 * DETIK + 500;
    assert.equal((await minta()).res.headers.get("retry-after"), "41");
  });

  it("lolos kembali tepat saat jendela berlalu", async () => {
    const { jam, minta } = await siap({ batas: 1, jendelaMs: MENIT, kunci: () => "k" });
    assert.equal((await minta()).res.status, 200);
    jam.t += MENIT - 1;
    assert.equal((await minta()).res.status, 429);
    jam.t += 1;
    assert.equal((await minta()).res.status, 200);
  });

  it("jendela geser: slot dibebaskan satu per satu, bukan semuanya sekaligus", async () => {
    const { jam, minta } = await siap({ batas: 3, jendelaMs: MENIT, kunci: () => "k" });
    assert.equal((await minta()).res.status, 200);
    jam.t += 10 * DETIK;
    assert.equal((await minta()).res.status, 200);
    jam.t += 10 * DETIK;
    assert.equal((await minta()).res.status, 200);
    jam.t += 10 * DETIK;
    const ditolak = await minta();
    assert.equal(ditolak.res.status, 429);
    assert.equal(ditolak.res.headers.get("retry-after"), "30");
    jam.t += 30 * DETIK;
    assert.equal((await minta()).res.status, 200);
    assert.equal((await minta()).res.status, 429);
  });

  it("permintaan yang ditolak tidak dihitung dan tidak memperpanjang blokir", async () => {
    const { jam, minta } = await siap({ batas: 3, jendelaMs: MENIT, kunci: () => "k" });
    for (let i = 0; i < 3; i++) await minta();
    jam.t += 30 * DETIK;
    for (let i = 0; i < 5; i++) assert.equal((await minta()).res.status, 429);
    jam.t += 30 * DETIK;
    assert.equal((await minta()).res.status, 200);
  });

  it("kunci berbeda dihitung sendiri-sendiri", async () => {
    const { minta } = await siap({ batas: 1, jendelaMs: MENIT, kunci: (req) => req.headers["x-kunci"] });
    assert.equal((await minta({ "x-kunci": "a" })).res.status, 200);
    assert.equal((await minta({ "x-kunci": "a" })).res.status, 429);
    assert.equal((await minta({ "x-kunci": "b" })).res.status, 200);
  });

  it("kunci gabungan IP dan email: email lain tidak ikut terkunci", async () => {
    const { server } = await siap({ batas: 2, jendelaMs: MENIT, kunci: (req) => req.ip + "|" + req.body.email });
    const kirim = async (email) =>
      (await fetch(server.url + "/masuk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      })).status;
    assert.equal(await kirim("a@x.id"), 200);
    assert.equal(await kirim("a@x.id"), 200);
    assert.equal(await kirim("a@x.id"), 429);
    assert.equal(await kirim("b@x.id"), 200);
  });

  it("tanpa fungsi kunci, bawaannya alamat IP pemanggil", async () => {
    const { minta } = await siap({ batas: 2, jendelaMs: MENIT });
    assert.equal((await minta()).res.status, 200);
    assert.equal((await minta()).res.status, 200);
    assert.equal((await minta()).res.status, 429);
  });

  it("jumlah kunci dibatasi: kunci dengan aktivitas paling lama dibuang lebih dulu", async () => {
    const { minta } = await siap({ batas: 1, jendelaMs: MENIT, maksKunci: 3, kunci: (req) => req.headers["x-kunci"] });
    for (const k of ["k1", "k2", "k3", "k4"]) assert.equal((await minta({ "x-kunci": k })).res.status, 200, k);
    assert.equal((await minta({ "x-kunci": "k1" })).res.status, 200, "k1 sudah dibuang, mulai dari nol");
    assert.equal((await minta({ "x-kunci": "k3" })).res.status, 429, "k3 masih tercatat");
  });

  it("saat melewati batas kunci, yang kedaluwarsa terbuang lebih dulu dan yang masih aktif tetap tercatat", async () => {
    const { jam, minta } = await siap({ batas: 1, jendelaMs: MENIT, maksKunci: 2, kunci: (req) => req.headers["x-kunci"] });
    await minta({ "x-kunci": "k1" });
    await minta({ "x-kunci": "k2" });
    jam.t += 61 * DETIK;
    assert.equal((await minta({ "x-kunci": "k3" })).res.status, 200);
    assert.equal((await minta({ "x-kunci": "k3" })).res.status, 429, "k3 aktif tidak ikut terbuang");
  });

  it("parameter tidak sah ditolak saat pembuatan", () => {
    assert.throws(() => buatPembatas({ batas: 0, jendelaMs: MENIT }), /batas/);
    assert.throws(() => buatPembatas({ batas: 1.5, jendelaMs: MENIT }), /batas/);
    assert.throws(() => buatPembatas({ batas: 1, jendelaMs: 0 }), /jendelaMs/);
    assert.throws(() => buatPembatas({ batas: 1, jendelaMs: MENIT, maksKunci: 0 }), /maksKunci/);
  });
});
