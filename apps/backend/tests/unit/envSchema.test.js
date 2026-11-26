import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bacaEnv, opsiDatabase } from "../../src/config/envSchema.js";

const SECRET = "x".repeat(32);
const KUNCI = Buffer.alloc(32, 7).toString("base64");
const dasar = { JWT_SECRET: SECRET };
const produksi = {
  NODE_ENV: "production",
  JWT_SECRET: SECRET,
  CORS_ORIGIN: "https://patunganku.example.com",
  DB_ENCRYPT: "true",
  DB_TRUST_SERVER_CERT: "false",
  PAYMENT_ENC_KEY: KUNCI,
};
const medan = (hasil) => hasil.errors.map((e) => e.field);

describe("bacaEnv: bawaan dan bentuk keluaran", () => {
  it("nilai bawaan lengkap bila hanya JWT_SECRET diisi", () => {
    const h = bacaEnv(dasar);
    assert.equal(h.ok, true);
    assert.deepEqual(h.env, {
      nodeEnv: "development",
      port: 4000,
      corsOrigin: "*",
      jwtSecret: SECRET,
      jwtExpiresIn: "1h",
      trustProxy: 0,
      dbEncrypt: false,
      dbTrustServerCert: true,
      paymentEncKey: null,
    });
  });

  it("nilai yang diisi dipakai", () => {
    const h = bacaEnv({ ...dasar, NODE_ENV: "test", PORT: "8080", JWT_EXPIRES_IN: "15m", TRUST_PROXY: "1", DB_ENCRYPT: "true", DB_TRUST_SERVER_CERT: "false" });
    assert.equal(h.ok, true);
    assert.equal(h.env.nodeEnv, "test");
    assert.equal(h.env.port, 8080);
    assert.equal(h.env.jwtExpiresIn, "15m");
    assert.equal(h.env.trustProxy, 1);
    assert.equal(h.env.dbEncrypt, true);
    assert.equal(h.env.dbTrustServerCert, false);
  });

  it("kunci lain di sumber diabaikan", () => {
    const h = bacaEnv({ ...dasar, DB_PASSWORD: "apa-saja", PATH: "/bin" });
    assert.equal(h.ok, true);
    assert.equal(Object.hasOwn(h.env, "DB_PASSWORD"), false);
  });
});

describe("bacaEnv: JWT_SECRET dan PORT", () => {
  it("JWT_SECRET kosong ditolak", () => {
    const h = bacaEnv({});
    assert.equal(h.ok, false);
    assert.deepEqual(medan(h), ["JWT_SECRET"]);
  });

  it("JWT_SECRET 31 karakter ditolak, 32 diterima", () => {
    assert.equal(bacaEnv({ JWT_SECRET: "x".repeat(31) }).ok, false);
    assert.equal(bacaEnv({ JWT_SECRET: "x".repeat(32) }).ok, true);
  });

  it("pesan galat JWT_SECRET menyebut 32 karakter", () => {
    const h = bacaEnv({ JWT_SECRET: "pendek" });
    assert.match(h.errors[0].message, /32 karakter/);
  });

  it("PORT: batas 1 sampai 65535 dan harus bulat", () => {
    assert.equal(bacaEnv({ ...dasar, PORT: "1" }).ok, true);
    assert.equal(bacaEnv({ ...dasar, PORT: "65535" }).ok, true);
    for (const buruk of ["0", "65536", "abc", "1.5", "-1"]) {
      const h = bacaEnv({ ...dasar, PORT: buruk });
      assert.equal(h.ok, false, "PORT " + buruk);
      assert.deepEqual(medan(h), ["PORT"]);
    }
  });

  it("beberapa galat skema dilaporkan sekaligus", () => {
    const h = bacaEnv({ JWT_SECRET: "pendek", PORT: "abc" });
    assert.deepEqual(medan(h).sort(), ["JWT_SECRET", "PORT"]);
  });
});

describe("bacaEnv: TRUST_PROXY", () => {
  it("0 sampai 5 diterima sebagai bilangan", () => {
    for (const n of [0, 1, 5]) {
      const h = bacaEnv({ ...dasar, TRUST_PROXY: String(n) });
      assert.equal(h.env.trustProxy, n);
    }
  });

  it("di luar 0 sampai 5, pecahan, atau bukan angka ditolak", () => {
    for (const buruk of ["6", "-1", "1.5", "banyak"]) {
      const h = bacaEnv({ ...dasar, TRUST_PROXY: buruk });
      assert.equal(h.ok, false, "TRUST_PROXY " + buruk);
      assert.deepEqual(medan(h), ["TRUST_PROXY"]);
    }
  });
});

describe("bacaEnv: CORS_ORIGIN", () => {
  it("* diterima (pengembangan) dan spasi di sekitarnya dipangkas", () => {
    assert.equal(bacaEnv({ ...dasar, CORS_ORIGIN: "*" }).env.corsOrigin, "*");
    assert.equal(bacaEnv({ ...dasar, CORS_ORIGIN: " * " }).env.corsOrigin, "*");
  });

  it("satu origin menjadi larik berisi satu", () => {
    assert.deepEqual(bacaEnv({ ...dasar, CORS_ORIGIN: "http://localhost:5173" }).env.corsOrigin, ["http://localhost:5173"]);
  });

  it("beberapa origin dipisah koma, spasi dipangkas, elemen kosong dibuang", () => {
    const h = bacaEnv({ ...dasar, CORS_ORIGIN: "http://a.com , https://b.com:8080,," });
    assert.deepEqual(h.env.corsOrigin, ["http://a.com", "https://b.com:8080"]);
  });

  it("garis miring di akhir, skema lain, jalur, dan kosong ditolak", () => {
    for (const buruk of ["http://a.com/", "ftp://a.com", "a.com", "http://a.com/path", "", " , ", "http://a.com,ftp://b.com", "http://a b.com"]) {
      const h = bacaEnv({ ...dasar, CORS_ORIGIN: buruk });
      assert.equal(h.ok, false, "CORS_ORIGIN '" + buruk + "'");
      assert.deepEqual(medan(h), ["CORS_ORIGIN"]);
    }
  });

  it("* tidak boleh dicampur dengan origin lain", () => {
    assert.equal(bacaEnv({ ...dasar, CORS_ORIGIN: "*,http://a.com" }).ok, false);
  });
});

describe("bacaEnv: boolean ketat", () => {
  it("hanya true dan false huruf kecil", () => {
    for (const buruk of ["TRUE", "1", "yes", "", "False"]) {
      assert.equal(bacaEnv({ ...dasar, DB_ENCRYPT: buruk }).ok, false, "DB_ENCRYPT '" + buruk + "'");
      assert.equal(bacaEnv({ ...dasar, DB_TRUST_SERVER_CERT: buruk }).ok, false, "DB_TRUST_SERVER_CERT '" + buruk + "'");
    }
  });

  it("pesan galat boolean menyebut true atau false", () => {
    const h = bacaEnv({ ...dasar, DB_ENCRYPT: "ya" });
    assert.match(h.errors[0].message, /true atau false/);
  });
});

describe("bacaEnv: aturan production", () => {
  it("konfigurasi production yang benar diterima", () => {
    const h = bacaEnv(produksi);
    assert.equal(h.ok, true);
    assert.deepEqual(h.env.corsOrigin, ["https://patunganku.example.com"]);
    assert.equal(h.env.dbEncrypt, true);
    assert.equal(h.env.dbTrustServerCert, false);
  });

  it("production menolak CORS * ", () => {
    const h = bacaEnv({ ...produksi, CORS_ORIGIN: "*" });
    assert.deepEqual(medan(h), ["CORS_ORIGIN"]);
    assert.match(h.errors[0].message, /production/);
  });

  it("production menolak enkripsi mati", () => {
    const h = bacaEnv({ ...produksi, DB_ENCRYPT: "false" });
    assert.deepEqual(medan(h), ["DB_ENCRYPT"]);
  });

  it("production menolak trustServerCertificate aktif", () => {
    const h = bacaEnv({ ...produksi, DB_TRUST_SERVER_CERT: "true" });
    assert.deepEqual(medan(h), ["DB_TRUST_SERVER_CERT"]);
  });

  it("production tanpa mengisi apa pun selain JWT_SECRET melaporkan empat galat", () => {
    const h = bacaEnv({ NODE_ENV: "production", JWT_SECRET: SECRET });
    assert.deepEqual(medan(h).sort(), ["CORS_ORIGIN", "DB_ENCRYPT", "DB_TRUST_SERVER_CERT", "PAYMENT_ENC_KEY"]);
  });

  it("CORS tidak sah di production hanya satu galat CORS", () => {
    const h = bacaEnv({ ...produksi, CORS_ORIGIN: "bukan-origin" });
    assert.deepEqual(medan(h), ["CORS_ORIGIN"]);
  });

  it("selain production, nilai longgar boleh", () => {
    for (const nodeEnv of ["development", "test", "staging"]) {
      const h = bacaEnv({ NODE_ENV: nodeEnv, JWT_SECRET: SECRET, CORS_ORIGIN: "*", DB_ENCRYPT: "false", DB_TRUST_SERVER_CERT: "true" });
      assert.equal(h.ok, true, nodeEnv);
    }
  });
});

describe("opsiDatabase", () => {
  it("bawaan lokal: tanpa enkripsi, sertifikat dipercaya", () => {
    assert.deepEqual(opsiDatabase({}), { encrypt: false, trustServerCertificate: true });
  });

  it("nilai Azure: enkripsi aktif, sertifikat tidak dipercaya", () => {
    assert.deepEqual(opsiDatabase({ DB_ENCRYPT: "true", DB_TRUST_SERVER_CERT: "false" }), { encrypt: true, trustServerCertificate: false });
  });

  it("dua bendera diurai terpisah", () => {
    assert.deepEqual(opsiDatabase({ DB_ENCRYPT: "true" }), { encrypt: true, trustServerCertificate: true });
    assert.deepEqual(opsiDatabase({ DB_TRUST_SERVER_CERT: "false" }), { encrypt: false, trustServerCertificate: false });
  });

  it("nilai tidak sah melempar Error", () => {
    assert.throws(() => opsiDatabase({ DB_ENCRYPT: "1" }), /true atau false/);
    assert.throws(() => opsiDatabase({ DB_TRUST_SERVER_CERT: "" }), /true atau false/);
  });

  it("kunci lain diabaikan dan tidak melempar saat JWT_SECRET kosong", () => {
    assert.deepEqual(opsiDatabase({ DB_PASSWORD: "x" }), { encrypt: false, trustServerCertificate: true });
  });
});

describe("bacaEnv: PAYMENT_ENC_KEY", () => {
  it("opsional di luar production: tidak diisi atau kosong menjadi null", () => {
    assert.equal(bacaEnv(dasar).env.paymentEncKey, null);
    assert.equal(bacaEnv({ ...dasar, PAYMENT_ENC_KEY: "" }).env.paymentEncKey, null);
    assert.equal(bacaEnv({ ...dasar, PAYMENT_ENC_KEY: "   " }).env.paymentEncKey, null);
  });

  it("kunci sah diteruskan apa adanya (spasi pinggir dipangkas)", () => {
    assert.equal(bacaEnv({ ...dasar, PAYMENT_ENC_KEY: KUNCI }).env.paymentEncKey, KUNCI);
    assert.equal(bacaEnv({ ...dasar, PAYMENT_ENC_KEY: " " + KUNCI + " " }).env.paymentEncKey, KUNCI);
  });

  it("kunci yang diisi tetapi tidak sah ditolak di semua lingkungan, tanpa membocorkan nilainya", () => {
    for (const salah of ["pendek", "x".repeat(44), Buffer.alloc(16, 1).toString("base64"), Buffer.alloc(33, 1).toString("base64")]) {
      const h = bacaEnv({ ...dasar, PAYMENT_ENC_KEY: salah });
      assert.equal(h.ok, false, salah);
      assert.deepEqual(medan(h), ["PAYMENT_ENC_KEY"]);
      assert.equal(JSON.stringify(h.errors).includes(salah), false);
    }
    assert.deepEqual(medan(bacaEnv({ ...produksi, PAYMENT_ENC_KEY: "pendek" })), ["PAYMENT_ENC_KEY"]);
  });

  it("wajib di production: tidak diisi atau kosong ditolak", () => {
    const { PAYMENT_ENC_KEY, ...tanpa } = produksi;
    assert.equal(PAYMENT_ENC_KEY, KUNCI);
    assert.deepEqual(medan(bacaEnv(tanpa)), ["PAYMENT_ENC_KEY"]);
    assert.deepEqual(medan(bacaEnv({ ...tanpa, PAYMENT_ENC_KEY: "" })), ["PAYMENT_ENC_KEY"]);
    assert.equal(bacaEnv(produksi).ok, true);
  });
});
