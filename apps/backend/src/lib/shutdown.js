// Penghentian bersih saat SIGTERM atau SIGINT. Murni: server, penutup database, penanda,
// pencatat, pengatur waktu, dan keluar disuntik. index.js adalah penyambung tipis.
// Urutan: tandai (readiness 503) -> server.close -> tutup database -> keluar.
// Kode keluar 0 hanya bila semuanya bersih; batas waktu atau galat memberi 1.
const HABIS = Symbol("habis");

function denganBatas(janji, ms, setTimer, hentikanTimer) {
  let timer;
  const habis = new Promise((selesai) => {
    timer = setTimer(() => selesai(HABIS), ms);
  });
  return Promise.race([janji, habis]).finally(() => hentikanTimer(timer));
}

export function buatShutdown({
  server,
  tutupDb,
  tandai,
  keluar,
  log = () => {},
  batasMs = 8000,
  setTimer = setTimeout,
  hentikanTimer = clearTimeout,
}) {
  let berjalan = null;

  async function jalankan(sinyal) {
    tandai();
    log("Menerima " + sinyal + ": berhenti menerima koneksi baru");
    let kode = 0;

    const serverTutup = new Promise((selesai) => {
      server.close((galat) => selesai(galat ? "galat" : "ok"));
      if (typeof server.closeIdleConnections === "function") server.closeIdleConnections();
    });
    const hasilServer = await denganBatas(serverTutup, batasMs, setTimer, hentikanTimer);
    if (hasilServer === HABIS) {
      log("Batas waktu penutupan server tercapai: koneksi dipaksa ditutup");
      if (typeof server.closeAllConnections === "function") server.closeAllConnections();
      kode = 1;
    } else if (hasilServer === "galat") {
      log("Server gagal ditutup");
      kode = 1;
    }

    try {
      const hasilDb = await denganBatas(tutupDb(), batasMs, setTimer, hentikanTimer);
      if (hasilDb === HABIS) {
        log("Batas waktu penutupan database tercapai");
        kode = 1;
      }
    } catch (galat) {
      log("Database gagal ditutup: " + galat.message);
      kode = 1;
    }

    log("Selesai, keluar dengan kode " + kode);
    keluar(kode);
  }

  function mulai(sinyal) {
    if (berjalan === null) berjalan = jalankan(sinyal);
    return berjalan;
  }

  return { mulai };
}
