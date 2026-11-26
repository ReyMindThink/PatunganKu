// Kode grup 6 karakter dari 32 huruf dan angka tanpa I, O, 0, 1 (K32: 32^6 kemungkinan).
import { randomInt } from "node:crypto";
import { GRUP } from "../config/constants.js";

export function buatKodeGrup(acak = randomInt) {
  let kode = "";
  for (let i = 0; i < GRUP.PANJANG_KODE; i++) kode += GRUP.ALFABET_KODE[acak(GRUP.ALFABET_KODE.length)];
  return kode;
}
