// Pembagian rupiah dengan largest remainder (G4, K7, K35). Murni. Perkalian memakai BigInt
// karena total hingga Rp100.000.000 dikali bobot dapat melewati bilangan bulat aman JavaScript.
// Hasil selalu berjumlah persis total dan urut id menaik. Pecahan sama besar: id terkecil
// mendapat rupiah sisa lebih dulu, supaya hasilnya deterministik dan dapat dites.
// Input tak sah adalah kesalahan pemrogram: Error biasa, bukan HttpError.

function bilanganTakNegatif(nama, nilai) {
  if (typeof nilai === "bigint") {
    if (nilai < 0n) throw new Error("pembagian: " + nama + " tidak boleh negatif");
    return nilai;
  }
  if (Number.isSafeInteger(nilai) === false || nilai < 0) {
    throw new Error("pembagian: " + nama + " harus bilangan bulat tak negatif yang aman");
  }
  return BigInt(nilai);
}

export function bagiProporsional(total, bobot) {
  const T = bilanganTakNegatif("total", total);
  if (T > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("pembagian: total terlalu besar");
  if (Array.isArray(bobot) === false || bobot.length === 0) throw new Error("pembagian: bobot tidak boleh kosong");

  const ids = new Set();
  const baris = bobot.map((b) => {
    if (Number.isSafeInteger(b?.id) === false || b.id <= 0) throw new Error("pembagian: id harus bilangan bulat positif");
    if (ids.has(b.id)) throw new Error("pembagian: id kembar " + b.id);
    ids.add(b.id);
    return { id: b.id, w: bilanganTakNegatif("bobot", b.bobot) };
  });
  baris.sort((x, y) => x.id - y.id);

  const S = baris.reduce((jumlah, b) => jumlah + b.w, 0n);
  if (S === 0n) throw new Error("pembagian: jumlah bobot harus lebih dari nol");

  let terbagi = 0n;
  for (const b of baris) {
    b.dasar = (T * b.w) / S;
    b.sisa = (T * b.w) % S;
    terbagi += b.dasar;
  }
  let lebih = T - terbagi;
  const urut = [...baris].sort((x, y) => (x.sisa === y.sisa ? x.id - y.id : x.sisa > y.sisa ? -1 : 1));
  for (const b of urut) {
    if (lebih === 0n) break;
    b.dasar += 1n;
    lebih -= 1n;
  }
  return baris.map((b) => ({ id: b.id, amount: Number(b.dasar) }));
}

// Merata: bobot sama untuk semua id.
export function bagiMerata(total, ids) {
  if (Array.isArray(ids) === false) throw new Error("pembagian: ids harus berupa daftar");
  return bagiProporsional(total, ids.map((id) => ({ id, bobot: 1 }))).map((b) => ({ userId: b.id, amount: b.amount }));
}
