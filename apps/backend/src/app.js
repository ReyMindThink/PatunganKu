import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { authRouter, meRouter } from "./routes/akun.routes.js";
import groupRoutes from "./routes/grup.routes.js";
import transaksiRoutes from "./routes/transaksi.routes.js";
import approvalRoutes from "./routes/approval.routes.js";
import ringkasanRoutes from "./routes/ringkasan.routes.js";
import ledgerRoutes from "./routes/ledger.routes.js";
import paymentRoutes from "./routes/payment.routes.js";
import strukRoutes from "./routes/struk.routes.js";
import { errorHandler, rutTidakDitemukan } from "./middlewares/errorHandler.js";

const app = express();

app.use(cors({ origin: env.corsOrigin }));
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api/auth", authRouter);
app.use("/api/me", meRouter);
app.use("/api/me", ringkasanRoutes);
app.use("/api/groups", groupRoutes);
app.use("/api/groups", transaksiRoutes);
app.use("/api/groups", approvalRoutes);
app.use("/api/groups", strukRoutes);
app.use("/api/groups/:groupId/balances", ledgerRoutes);
app.use("/api/groups/:groupId/payments", paymentRoutes);

app.use(rutTidakDitemukan);

app.use(errorHandler);

export default app;
