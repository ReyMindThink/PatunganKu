import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import authRoutes from "./routes/auth.routes.js";
import groupRoutes from "./routes/group.routes.js";
import transactionRoutes from "./routes/transaction.routes.js";
import ledgerRoutes from "./routes/ledger.routes.js";
import paymentRoutes from "./routes/payment.routes.js";
import { errorHandler } from "./middlewares/errorHandler.js";

const app = express();

app.use(cors({ origin: env.corsOrigin }));
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/groups", groupRoutes);
app.use("/api/groups/:groupId/transactions", transactionRoutes);
app.use("/api/groups/:groupId/balances", ledgerRoutes);
app.use("/api/groups/:groupId/payments", paymentRoutes);

app.use((req, res) => {
  res.status(404).json({ error: "route-not-found" });
});

app.use(errorHandler);

export default app;
