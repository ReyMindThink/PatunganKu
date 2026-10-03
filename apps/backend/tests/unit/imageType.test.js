import test from "node:test";
import assert from "node:assert/strict";
import { detectImageType } from "../../src/utils/imageType.js";

test("mengenali JPEG, PNG, WebP dari byte awal", () => {
  assert.equal(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0])), "image/jpeg");
  assert.equal(detectImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "image/png");
  assert.equal(detectImageType(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")])), "image/webp");
});

test("menolak teks dan buffer kosong", () => {
  assert.equal(detectImageType(Buffer.from("bukan gambar")), null);
  assert.equal(detectImageType(Buffer.alloc(0)), null);
});
