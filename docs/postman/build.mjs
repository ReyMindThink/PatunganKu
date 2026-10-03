import { writeFileSync } from "node:fs";

const json = (body) => ({
  mode: "raw",
  raw: JSON.stringify(body, null, 2),
  options: { raw: { language: "json" } },
});

const req = (name, method, path, body, test) => ({
  name,
  event: test
    ? [{ listen: "test", script: { type: "text/javascript", exec: test.split("\n") } }]
    : [],
  request: {
    method,
    header: body ? [{ key: "Content-Type", value: "application/json" }] : [],
    body: body ? json(body) : undefined,
    url: {
      raw: "{{baseUrl}}" + path,
      host: ["{{baseUrl}}"],
      path: path.replace(/^\//, "").split("/"),
    },
  },
});

const saveToken = `const j = pm.response.json();
if (j.token) pm.collectionVariables.set("token", j.token);`;

const collection = {
  info: {
    name: "PatunganKu API",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  auth: { type: "bearer", bearer: [{ key: "token", value: "{{token}}", type: "string" }] },
  variable: [
    { key: "baseUrl", value: "http://localhost:4000" },
    { key: "token", value: "" },
    { key: "groupId", value: "1" },
    { key: "groupCode", value: "" },
    { key: "transactionId", value: "1" },
    { key: "paymentId", value: "1" },
  ],
  item: [
    { name: "Health", item: [req("Health check", "GET", "/api/health")] },
    {
      name: "Auth",
      item: [
        req("Register", "POST", "/api/auth/register",
          { email: "user@example.com", password: "rahasia123", name: "Nama User", phone: "08123456789" }, saveToken),
        req("Login", "POST", "/api/auth/login",
          { email: "user@example.com", password: "rahasia123" }, saveToken),
        req("Me", "GET", "/api/auth/me"),
      ],
    },
    {
      name: "Groups",
      item: [
        req("Buat grup", "POST", "/api/groups", { name: "Kos Mawar" },
          `const g = pm.response.json().group;
if (g) { pm.collectionVariables.set("groupId", g.id); pm.collectionVariables.set("groupCode", g.code); }`),
        req("Gabung grup", "POST", "/api/groups/join", { code: "{{groupCode}}" }),
        req("Daftar grup saya", "GET", "/api/groups"),
        req("Detail grup", "GET", "/api/groups/{{groupId}}"),
      ],
    },
    {
      name: "Transactions",
      item: [
        req("Buat transaksi (EQUAL)", "POST", "/api/groups/{{groupId}}/transactions",
          { description: "Belanja bulanan", amount: 100001, mode: "EQUAL", participantIds: [1, 2] },
          `const t = pm.response.json().transaction;
if (t) pm.collectionVariables.set("transactionId", t.id);`),
        req("Buat transaksi (CUSTOM)", "POST", "/api/groups/{{groupId}}/transactions",
          { description: "Makan malam", amount: 50000, mode: "CUSTOM",
            splits: [{ userId: 1, amount: 30000 }, { userId: 2, amount: 20000 }] }),
        req("Daftar transaksi", "GET", "/api/groups/{{groupId}}/transactions"),
        {
          name: "Upload struk",
          request: {
            method: "POST",
            header: [],
            body: { mode: "formdata", formdata: [{ key: "receipt", type: "file", src: [] }] },
            url: {
              raw: "{{baseUrl}}/api/groups/{{groupId}}/transactions/{{transactionId}}/receipt",
              host: ["{{baseUrl}}"],
              path: ["api", "groups", "{{groupId}}", "transactions", "{{transactionId}}", "receipt"],
            },
          },
        },
        req("Verifikasi struk (Gemini)", "POST", "/api/groups/{{groupId}}/transactions/{{transactionId}}/receipt/verify"),
      ],
    },
    {
      name: "Balances",
      item: [req("Saldo dan rekomendasi pelunasan", "GET", "/api/groups/{{groupId}}/balances")],
    },
    {
      name: "Payments",
      item: [
        req("Buat pelunasan", "POST", "/api/groups/{{groupId}}/payments", { receiverId: 1, amount: 20000 },
          `const p = pm.response.json().payment;
if (p) pm.collectionVariables.set("paymentId", p.id);`),
        req("Setujui / tolak pelunasan", "PATCH", "/api/groups/{{groupId}}/payments/{{paymentId}}",
          { decision: "CONFIRMED" }),
        req("Daftar pelunasan", "GET", "/api/groups/{{groupId}}/payments"),
      ],
    },
  ],
};

writeFileSync(
  new URL("./PatunganKu.postman_collection.json", import.meta.url),
  JSON.stringify(collection, null, 2) + "\n",
);
console.log("OK: koleksi dibuat");
