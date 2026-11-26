import { env } from "./config/env.js";
import app from "./app.js";
import { prisma } from "./lib/prisma.js";
import { buatShutdown } from "./lib/shutdown.js";
import { tandaiShutdown } from "./lib/statusServer.js";

const server = app.listen(env.port, () => {
  console.log(`PatunganKu backend running on port ${env.port}`);
});

const shutdown = buatShutdown({
  server,
  tutupDb: () => prisma.$disconnect(),
  tandai: tandaiShutdown,
  keluar: (kode) => process.exit(kode),
  log: (pesan) => console.log(pesan),
});

for (const sinyal of ["SIGTERM", "SIGINT"]) {
  process.on(sinyal, () => {
    shutdown.mulai(sinyal);
  });
}
