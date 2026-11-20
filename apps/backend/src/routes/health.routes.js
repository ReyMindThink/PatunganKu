import { prisma } from "../lib/prisma.js";
import { sedangShutdown } from "../lib/statusServer.js";
import { buatRouterHealth } from "./health.router.js";

export default buatRouterHealth({
  cekDb: () => prisma.$queryRaw`SELECT 1 AS ok`,
  sedangShutdown,
});
