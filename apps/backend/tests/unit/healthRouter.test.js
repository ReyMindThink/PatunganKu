import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mulaiAplikasi } from "../helpers/http.js";
import { buatRouterHealth } from "../../src/routes/health.router.js";

const WAKTU = new Date("2026-11-20T03:04:05.678Z");

async function pasang(opsi) {
  const panggilan = { db: 0 };
  const router = buatRouterHealth({
    cekDb: async () => { panggilan.db += 1; },
    sedangShutdown: () => false,
    sekarang: () => WAKTU,
    ...opsi,
  });
  const server = await mulaiAplikasi((app) => app.use("/api/health", router));
  return { server, panggilan };
}

describe("router health", async () => {
  const semua = [];
  const baru = async (opsi) => {
    const x = await pasang(opsi);
    semua.push(x.server);
    return x;
  };
  after(async () => { for (const s of semua) await s.tutup(); });

  it("GET / hidup tanpa menyentuh database", async () => {
    const { server, panggilan } = await baru();
    const res = await fetch(server.url + "/api/health");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok", timestamp: "2026-11-20T03:04:05.678Z" });
    assert.equal(panggilan.db, 0);
  });

  it("GET / tanpa sekarang suntikan memakai jam sistem", async () => {
    const router = buatRouterHealth({ cekDb: async () => {}, sedangShutdown: () => false });
    const server = await mulaiAplikasi((app) => app.use("/api/health", router));
    semua.push(server);
    const sebelum = Date.now();
    const badan = await (await fetch(server.url + "/api/health")).json();
    const waktu = new Date(badan.timestamp).getTime();
    assert.equal(waktu >= sebelum - 1000 && waktu <= Date.now() + 1000, true);
  });

  it("GET / tetap 200 saat database mati dan saat berhenti", async () => {
    const { server } = await baru({ cekDb: async () => { throw new Error("mati"); }, sedangShutdown: () => true });
    assert.equal((await fetch(server.url + "/api/health")).status, 200);
  });

  it("GET /ready siap: 200 dengan cek database ok dan tanpa cache", async () => {
    const { server, panggilan } = await baru();
    const res = await fetch(server.url + "/api/health/ready");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(await res.json(), { status: "ready", checks: { database: "ok" } });
    assert.equal(panggilan.db, 1);
  });

  it("GET /ready: database menolak memberi 503 tanpa membocorkan isi galat", async () => {
    const { server } = await baru({ cekDb: async () => { throw new Error("rahasia-koneksi-sa"); } });
    const res = await fetch(server.url + "/api/health/ready");
    const teks = await res.text();
    assert.equal(res.status, 503);
    assert.deepEqual(JSON.parse(teks), { status: "unavailable", checks: { database: "down" } });
    assert.equal(teks.includes("rahasia-koneksi-sa"), false);
  });

  it("GET /ready: database melempar serentak memberi 503", async () => {
    const { server } = await baru({ cekDb: () => { throw new Error("langsung"); } });
    const res = await fetch(server.url + "/api/health/ready");
    assert.equal(res.status, 503);
    assert.equal((await res.json()).checks.database, "down");
  });

  it("GET /ready: database menggantung melewati batas waktu memberi 503", async () => {
    const { server } = await baru({ cekDb: () => new Promise(() => {}), batasMs: 30 });
    const mulai = Date.now();
    const res = await fetch(server.url + "/api/health/ready");
    assert.equal(res.status, 503);
    assert.equal((await res.json()).status, "unavailable");
    assert.equal(Date.now() - mulai < 2000, true);
  });

  it("GET /ready: sedang berhenti memberi 503 tanpa memeriksa database", async () => {
    const { server, panggilan } = await baru({ sedangShutdown: () => true });
    const res = await fetch(server.url + "/api/health/ready");
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(await res.json(), { status: "shutting-down", checks: {} });
    assert.equal(panggilan.db, 0);
  });

  it("GET /ready memakai batas waktu yang diberikan dan menghentikan pengatur waktu", async () => {
    const dipasang = [];
    const dihentikan = [];
    const { server } = await baru({
      batasMs: 777,
      setTimer: (fn, ms) => { const t = { fn, ms }; dipasang.push(t); return t; },
      hentikanTimer: (t) => dihentikan.push(t),
    });
    const res = await fetch(server.url + "/api/health/ready");
    assert.equal(res.status, 200);
    assert.equal(dipasang.length, 1);
    assert.equal(dipasang[0].ms, 777);
    assert.deepEqual(dihentikan, [dipasang[0]]);
  });

  it("batas waktu bawaan 3000 ms", async () => {
    const dipasang = [];
    const { server } = await baru({
      setTimer: (fn, ms) => { const t = { fn, ms }; dipasang.push(t); return t; },
      hentikanTimer: () => {},
    });
    await fetch(server.url + "/api/health/ready");
    assert.equal(dipasang[0].ms, 3000);
  });

  it("pengatur waktu juga dihentikan saat database gagal", async () => {
    const dipasang = [];
    const dihentikan = [];
    const { server } = await baru({
      cekDb: async () => { throw new Error("x"); },
      setTimer: (fn, ms) => { const t = { fn, ms }; dipasang.push(t); return t; },
      hentikanTimer: (t) => dihentikan.push(t),
    });
    await fetch(server.url + "/api/health/ready");
    assert.deepEqual(dihentikan, dipasang);
  });

  it("setiap permintaan memeriksa database sekali", async () => {
    const { server, panggilan } = await baru();
    await fetch(server.url + "/api/health/ready");
    await fetch(server.url + "/api/health/ready");
    assert.equal(panggilan.db, 2);
  });

  it("metode selain GET dan jalur lain memberi 404", async () => {
    const { server } = await baru();
    assert.equal((await fetch(server.url + "/api/health/ready", { method: "POST" })).status, 404);
    assert.equal((await fetch(server.url + "/api/health/lain")).status, 404);
  });
});
