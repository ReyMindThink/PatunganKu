import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gantiPasswordSchema, loginSchema, registerSchema, ubahProfilSchema } from "../../src/validators/auth.validator.js";

const dasar = { email: "rey@example.com", password: "rahasia-123", name: "Rey" };
const salah = (skema, isi, field) => {
  const r = skema.safeParse(isi);
  assert.equal(r.success, false, JSON.stringify(isi).slice(0, 60));
  if (field) assert.ok(r.error.issues.some((i) => i.path.join(".") === field), "field " + field);
};
const sah = (skema, isi) => {
  const r = skema.safeParse(isi);
  assert.equal(r.success, true, JSON.stringify(isi).slice(0, 60));
  return r.data;
};
const emailPanjang = (total) => {
  const lokal = "a".repeat(64);
  const sisa = total - lokal.length - 1;
  const domain = ["b".repeat(63), "b".repeat(63), "b".repeat(sisa - 128)].join(".");
  return lokal + "@" + domain;
};

describe("validator akun", () => {
  it("register: email dipangkas dan huruf kecil, nama dipangkas, password tidak dipangkas, phone dibuang", () => {
    const d = sah(registerSchema, { email: "  REY@Example.COM ", password: "  spasi-1  ", name: "  Rey  ", phone: "0812" });
    assert.deepEqual(d, { email: "rey@example.com", password: "  spasi-1  ", name: "Rey" });
  });

  it("email: format salah ditolak; tepat 254 karakter diterima, 255 ditolak", () => {
    for (const e of ["", "a", "a@", "@b.com", "a b@c.com", "a@b", 5, null, undefined]) salah(registerSchema, { ...dasar, email: e }, "email");
    assert.equal(emailPanjang(254).length, 254);
    assert.equal(emailPanjang(255).length, 255);
    sah(registerSchema, { ...dasar, email: emailPanjang(254) });
    salah(registerSchema, { ...dasar, email: emailPanjang(255) }, "email");
  });

  it("password: minimal 8 karakter (titik kode), emoji dihitung satu karakter", () => {
    salah(registerSchema, { ...dasar, password: "1234567" }, "password");
    sah(registerSchema, { ...dasar, password: "12345678" });
    salah(registerSchema, { ...dasar, password: "\u{1F600}".repeat(4) }, "password");
    sah(registerSchema, { ...dasar, password: "\u{1F600}".repeat(8) });
    salah(registerSchema, { ...dasar, password: 12345678 }, "password");
  });

  it("password: batas 72 byte UTF-8, bukan 72 karakter (ASCII, huruf beraksen, emoji)", () => {
    sah(registerSchema, { ...dasar, password: "a".repeat(72) });
    salah(registerSchema, { ...dasar, password: "a".repeat(73) }, "password");
    sah(registerSchema, { ...dasar, password: "\u00e9".repeat(36) });
    salah(registerSchema, { ...dasar, password: "\u00e9".repeat(37) }, "password");
    sah(registerSchema, { ...dasar, password: "\u{1F600}".repeat(18) });
    salah(registerSchema, { ...dasar, password: "\u{1F600}".repeat(19) }, "password");
    salah(registerSchema, { ...dasar, password: "\u{1F600}".repeat(36) }, "password");
  });

  it("nama: kosong atau spasi saja ditolak; 100 karakter diterima, 101 ditolak; wajib ada", () => {
    for (const n of ["", "   ", 5, undefined]) salah(registerSchema, { ...dasar, name: n }, "name");
    assert.equal(sah(registerSchema, { ...dasar, name: "n".repeat(100) }).name.length, 100);
    salah(registerSchema, { ...dasar, name: "n".repeat(101) }, "name");
  });

  it("login: password wajib dan maksimal 72 byte; email dinormalisasi", () => {
    const d = sah(loginSchema, { email: " REY@Example.com ", password: "x" });
    assert.equal(d.email, "rey@example.com");
    salah(loginSchema, { email: "rey@example.com", password: "" }, "password");
    salah(loginSchema, { email: "rey@example.com" }, "password");
    sah(loginSchema, { email: "rey@example.com", password: "a".repeat(72) });
    salah(loginSchema, { email: "rey@example.com", password: "a".repeat(73) }, "password");
    salah(loginSchema, { email: "rey@example.com", password: "\u00e9".repeat(37) }, "password");
  });

  it("ubah profil: hanya name; field lain dibuang; name wajib", () => {
    assert.deepEqual(sah(ubahProfilSchema, { name: " Baru ", email: "x@y.com", notifyByEmail: true }), { name: "Baru" });
    salah(ubahProfilSchema, {}, "name");
    salah(ubahProfilSchema, { name: "   " }, "name");
    salah(ubahProfilSchema, { name: "n".repeat(101) }, "name");
  });

  it("ganti password: dua field wajib; currentPassword maksimal 72 byte; newPassword aturan password", () => {
    const ok = { currentPassword: "lama-12345", newPassword: "baru-12345" };
    assert.deepEqual(sah(gantiPasswordSchema, { ...ok, lain: 1 }), ok);
    salah(gantiPasswordSchema, { newPassword: "baru-12345" }, "currentPassword");
    salah(gantiPasswordSchema, { currentPassword: "lama-12345" }, "newPassword");
    salah(gantiPasswordSchema, { ...ok, currentPassword: "a".repeat(73) }, "currentPassword");
    sah(gantiPasswordSchema, { ...ok, currentPassword: "a".repeat(72) });
    salah(gantiPasswordSchema, { ...ok, newPassword: "pendek" }, "newPassword");
    salah(gantiPasswordSchema, { ...ok, newPassword: "\u00e9".repeat(37) }, "newPassword");
  });
});
