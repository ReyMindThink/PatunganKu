# Image backend PatunganKu (satu tahap). Prisma CLI (devDependency) sengaja tetap ada
# supaya "npx prisma migrate deploy" dapat dijalankan dari image yang sama.
# npm ci menjalankan postinstall (prisma generate); URL di bawah hanya tiruan untuk build.
FROM node:24-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN DATABASE_URL="sqlserver://localhost:1433;database=build;user=build;password=build" npm ci

COPY src ./src

ENV PORT=4000
EXPOSE 4000
USER node

# Hidup saja (tanpa database): database mati tidak boleh membuat container dimulai ulang terus.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 4000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "src/index.js"]
