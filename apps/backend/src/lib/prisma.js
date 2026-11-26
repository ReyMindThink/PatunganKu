import "dotenv/config";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { PrismaClient } from "../generated/prisma/index.js";
import { opsiDatabase } from "../config/envSchema.js";

const adapter = new PrismaMssql({
  server: process.env.DB_SERVER,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: opsiDatabase(process.env),
});

export const prisma = new PrismaClient({ adapter });
