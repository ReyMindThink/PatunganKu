import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { authRouter, meRouter } from "./routes/akun.routes.js";
import groupRoutes from "./routes/grup.routes.js";
import transaksiRoutes from "./routes/transaksi.routes.js";
import approvalRoutes from "./routes/approval.routes.js";
import ringkasanRoutes from "./routes/ringkasan.routes.js";
import { saldoGrup, saldoSaya } from "./routes/saldo.routes.js";
import strukRoutes from "./routes/struk.routes.js";
import { errorHandler, rutTidakDitemukan } from "./middlewares/errorHandler.js";
import healthRoutes from "./routes/health.routes.js";

const app = express();

app.set("trust proxy", env.trustProxy);

app.use(cors({ origin: env.corsOrigin }));
app.use(express.json());

app.use("/api/health", healthRoutes);

app.use("/api/auth", authRouter);
app.use("/api/me", meRouter);
app.use("/api/me", ringkasanRoutes);
app.use("/api/me", saldoSaya);
app.use("/api/groups", groupRoutes);
app.use("/api/groups", transaksiRoutes);
app.use("/api/groups", approvalRoutes);
app.use("/api/groups", strukRoutes);
app.use("/api/groups", saldoGrup);

app.use(rutTidakDitemukan);

app.use(errorHandler);

export default app;
