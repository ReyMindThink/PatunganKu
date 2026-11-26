import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buatShutdown } from "../../src/lib/shutdown.js";

const tunggu = () => new Promise((selesai) => setImmediate(selesai));

async function tungguSampai(kondisi) {
  for (let i = 0; i < 50 && kondisi() === false; i++) await tunggu();
  assert.equal(kondisi(), true, "kondisi tidak terpenuhi");
}

// Server palsu: mode "ok" memanggil callback close; "galat" memanggilnya dengan Error; "tahan" tidak pernah.
function buatServer(peristiwa, mode = "ok", lengkap = true) {
  const server = {
    close(cb) {
      peristiwa.push("close");
      if (mode === "ok") queueMicrotask(() => cb());
      if (mode === "galat") queueMicrotask(() => cb(new Error("gagal")));
    },
  };
  if (lengkap) {
    server.closeIdleConnections = () => peristiwa.push("idle");
    server.closeAllConnections = () => peristiwa.push("semua");
  }
  return server;
}

function siapkan({ mode = "ok", lengkap = true, tutupDb, batasMs } = {}) {
  const peristiwa = [];
  const pencatat = [];
  const timers = [];
  const kode = [];
  const opsi = {
    server: buatServer(peristiwa, mode, lengkap),
    tutupDb: tutupDb ?? (async () => { peristiwa.push("db"); }),
    tandai: () => peristiwa.push("tandai"),
    keluar: (k) => { peristiwa.push("keluar"); kode.push(k); },
    log: (m) => pencatat.push(m),
    setTimer: (fn, ms) => { const t = { fn, ms, dihentikan: false }; timers.push(t); return t; },
    hentikanTimer: (t) => { t.dihentikan = true; },
  };
  if (typeof batasMs === "number") opsi.batasMs = batasMs;
  return { opsi, peristiwa, pencatat, timers, kode, shutdown: buatShutdown(opsi) };
}

describe("buatShutdown: jalur bersih", () => {
  it("urutan: tandai, close, idle, db, keluar dengan kode 0", async () => {
    const s = siapkan();
    await s.shutdown.mulai("SIGTERM");
    assert.deepEqual(s.peristiwa, ["tandai", "close", "idle", "db", "keluar"]);
    assert.deepEqual(s.kode, [0]);
  });

  it("jalur bersih tidak memaksa menutup semua koneksi", async () => {
    const s = siapkan();
    await s.shutdown.mulai("SIGTERM");
    assert.equal(s.peristiwa.includes("semua"), false);
  });

  it("log menyebut sinyal dan kode keluar", async () => {
    const s = siapkan();
    await s.shutdown.mulai("SIGINT");
    assert.match(s.pencatat[0], /SIGINT/);
    assert.match(s.pencatat[s.pencatat.length - 1], /kode 0/);
  });

  it("keluar menunggu penutupan database selesai", async () => {
    let lepas;
    const s = siapkan({ tutupDb: () => new Promise((selesai) => { lepas = selesai; }) });
    const p = s.shutdown.mulai("SIGTERM");
    await tungguSampai(() => typeof lepas === "function");
    assert.deepEqual(s.kode, []);
    lepas();
    await p;
    assert.deepEqual(s.kode, [0]);
  });

  it("semua pengatur waktu dihentikan setelah selesai", async () => {
    const s = siapkan();
    await s.shutdown.mulai("SIGTERM");
    assert.equal(s.timers.length, 2);
    assert.equal(s.timers.every((t) => t.dihentikan), true);
  });

  it("batas waktu bawaan 8000 ms dan dapat diganti, untuk server dan database", async () => {
    const a = siapkan();
    await a.shutdown.mulai("SIGTERM");
    assert.deepEqual(a.timers.map((t) => t.ms), [8000, 8000]);
    const b = siapkan({ batasMs: 1234 });
    await b.shutdown.mulai("SIGTERM");
    assert.deepEqual(b.timers.map((t) => t.ms), [1234, 1234]);
  });

  it("server tanpa metode closeIdleConnections dan closeAllConnections tidak error", async () => {
    const s = siapkan({ lengkap: false });
    await s.shutdown.mulai("SIGTERM");
    assert.deepEqual(s.kode, [0]);
  });
});

describe("buatShutdown: kegagalan", () => {
  it("server gagal ditutup: database tetap ditutup, kode 1", async () => {
    const s = siapkan({ mode: "galat" });
    await s.shutdown.mulai("SIGTERM");
    assert.equal(s.peristiwa.includes("db"), true);
    assert.deepEqual(s.kode, [1]);
    assert.equal(s.pencatat.some((m) => /gagal ditutup/.test(m)), true);
  });

  it("batas waktu server: koneksi dipaksa ditutup, database tetap ditutup, kode 1", async () => {
    const s = siapkan({ mode: "tahan" });
    const p = s.shutdown.mulai("SIGTERM");
    assert.equal(s.timers.length, 1);
    s.timers[0].fn();
    await p;
    assert.deepEqual(s.peristiwa, ["tandai", "close", "idle", "semua", "db", "keluar"]);
    assert.deepEqual(s.kode, [1]);
  });

  it("batas waktu server tanpa closeAllConnections tidak error", async () => {
    const s = siapkan({ mode: "tahan", lengkap: false });
    const p = s.shutdown.mulai("SIGTERM");
    s.timers[0].fn();
    await p;
    assert.deepEqual(s.kode, [1]);
  });

  it("penutupan database menolak: kode 1 dan pesan dicatat", async () => {
    const s = siapkan({ tutupDb: async () => { throw new Error("putus"); } });
    await s.shutdown.mulai("SIGTERM");
    assert.deepEqual(s.kode, [1]);
    assert.equal(s.pencatat.some((m) => /putus/.test(m)), true);
  });

  it("penutupan database melempar serentak: kode 1", async () => {
    const s = siapkan({ tutupDb: () => { throw new Error("langsung"); } });
    await s.shutdown.mulai("SIGTERM");
    assert.deepEqual(s.kode, [1]);
    assert.equal(s.pencatat.some((m) => /langsung/.test(m)), true);
  });

  it("penutupan database menggantung: batas waktu kedua memberi kode 1", async () => {
    const s = siapkan({ tutupDb: () => new Promise(() => {}) });
    const p = s.shutdown.mulai("SIGTERM");
    await tungguSampai(() => s.timers.length === 2);
    s.timers[1].fn();
    await p;
    assert.deepEqual(s.kode, [1]);
    assert.equal(s.pencatat.some((m) => /database tercapai/.test(m)), true);
  });
});

describe("buatShutdown: log dan parameter opsional", () => {
  it("log kegagalan menyebut kode keluar 1", async () => {
    const s = siapkan({ mode: "galat" });
    await s.shutdown.mulai("SIGTERM");
    assert.match(s.pencatat[s.pencatat.length - 1], /kode 1$/);
  });

  it("tanpa parameter log tetap berjalan sampai keluar", async () => {
    const kode = [];
    const peristiwa = [];
    const shutdown = buatShutdown({
      server: buatServer(peristiwa),
      tutupDb: async () => {},
      tandai: () => {},
      keluar: (k) => kode.push(k),
    });
    await shutdown.mulai("SIGTERM");
    assert.deepEqual(kode, [0]);
  });
});

describe("buatShutdown: panggilan berulang", () => {
  it("sinyal kedua tidak menjalankan ulang dan mengembalikan janji yang sama", async () => {
    const s = siapkan();
    const p1 = s.shutdown.mulai("SIGTERM");
    const p2 = s.shutdown.mulai("SIGINT");
    assert.equal(p1, p2);
    await p1;
    assert.equal(s.peristiwa.filter((e) => e === "close").length, 1);
    assert.equal(s.peristiwa.filter((e) => e === "tandai").length, 1);
    assert.deepEqual(s.kode, [0]);
  });
});
