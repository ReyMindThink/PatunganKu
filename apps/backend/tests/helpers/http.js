// Aplikasi Express mini untuk tes HTTP: memasang middleware asli, rute uji lokal, dan
// errorHandler. Tidak menyentuh src/app.js, jadi tidak butuh .env maupun database.
import express from "express";
import { errorHandler, rutTidakDitemukan } from "../../src/middlewares/errorHandler.js";

export async function mulaiAplikasi(pasang, { json = true } = {}) {
  const app = express();
  if (json) app.use(express.json());
  pasang(app);
  app.use(rutTidakDitemukan);
  app.use(errorHandler);

  const server = await new Promise((selesai) => {
    const s = app.listen(0, "127.0.0.1", () => selesai(s));
  });

  return {
    url: `http://127.0.0.1:${server.address().port}`,
    tutup: () =>
      new Promise((selesai) => {
        server.close(selesai);
        server.closeAllConnections();
      }),
  };
}
