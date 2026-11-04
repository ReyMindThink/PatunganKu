import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { authRouter, meRouter } from "./routes/akun.routes.js";
import groupRoutes from "./routes/grup.routes.js";
import transaksiRoutes from "./routes/transaksi.routes.js";
import ledgerRoutes from "./routes/ledger.routes.js";
import paymentRoutes from "./routes/payment.routes.js";
import receiptRoutes from "./routes/receipt.routes.js";
import { errorHandler, rutTidakDitemukan } from "./middlewares/errorHandler.js";

const app = express();

app.use(cors({ origin: env.corsOrigin }));
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api/auth", authRouter);
app.use("/api/me", meRouter);
app.use("/api/groups", groupRoutes);
app.use("/api/groups", transaksiRoutes);
app.use("/api/groups/:groupId/transactions", receiptRoutes);
app.use("/api/groups/:groupId/balances", ledgerRoutes);
app.use("/api/groups/:groupId/payments", paymentRoutes);

app.use(rutTidakDitemukan);

app.use(errorHandler);

export default app;
