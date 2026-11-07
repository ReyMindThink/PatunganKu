// Pengecekan sintaks semua berkas .js di src, tests, dan scripts (node --check).
// Ini bukan lint: hanya memastikan berkas dapat di-parse.
import { readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const akar = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lewati = new Set(["node_modules", "generated"]);

function kumpulkan(dir, hasil = []) {
  for (const nama of readdirSync(dir)) {
    if (lewati.has(nama)) continue;
    const jalur = join(dir, nama);
    if (statSync(jalur).isDirectory()) kumpulkan(jalur, hasil);
    else if (nama.endsWith(".js")) hasil.push(jalur);
  }
  return hasil;
}

const berkas = ["src", "tests", "scripts"].flatMap((d) => kumpulkan(join(akar, d)));
let gagal = 0;
for (const berkasIni of berkas) {
  try {
    execFileSync(process.execPath, ["--check", berkasIni], { stdio: "pipe" });
  } catch (e) {
    gagal += 1;
    console.error("GAGAL: " + berkasIni + "\n" + (e.stderr ? e.stderr.toString() : e.message));
  }
}
console.log(berkas.length + " berkas diperiksa, " + gagal + " gagal");
process.exit(gagal > 0 ? 1 : 0);
