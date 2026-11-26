// Pemeriksaan kesehatan. GET / = hidup (tanpa menyentuh database); GET /ready = siap
// melayani: database menjawab dalam batas waktu dan proses tidak sedang berhenti.
// Isi galat tidak pernah dikirim ke klien (hanya "ok" atau "down").
import { Router } from "express";

const HABIS = Symbol("habis");

export function buatRouterHealth({
  cekDb,
  sedangShutdown,
  sekarang = () => new Date(),
  batasMs = 3000,
  setTimer = setTimeout,
  hentikanTimer = clearTimeout,
}) {
  const router = Router();

  router.get("/", (req, res) => {
    res.json({ status: "ok", timestamp: sekarang().toISOString() });
  });

  router.get("/ready", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (sedangShutdown()) {
      return res.status(503).json({ status: "shutting-down", checks: {} });
    }
    let timer;
    const habis = new Promise((selesai) => {
      timer = setTimer(() => selesai(HABIS), batasMs);
    });
    let siap;
    try {
      const hasil = await Promise.race([cekDb(), habis]);
      siap = (hasil === HABIS) === false;
    } catch {
      siap = false;
    } finally {
      hentikanTimer(timer);
    }
    res.status(siap ? 200 : 503).json({
      status: siap ? "ready" : "unavailable",
      checks: { database: siap ? "ok" : "down" },
    });
  });

  return router;
}
