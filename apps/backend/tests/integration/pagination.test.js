// Kursor id (terbaru lebih dulu) pada tabel Transaction di SQL Server nyata, lewat
// ambilHalaman dan Prisma Client. Data uji unik per tes (grup sendiri), tanpa DELETE.
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { prisma } from "../helpers/db.js";
import { buatAnggota, buatGrup, buatTransaksi, buatUser } from "../helpers/factories.js";
import { ambilHalaman } from "../../src/utils/pagination.js";

const skemaKursor = z.object({ id: z.number().int().positive().max(2147483647) });
const buatKursor = (baris) => ({ id: baris.id });

// Satu grup dengan jumlah transaksi tertentu; mengembalikan id-nya dari yang terbaru.
async function siapkan(jumlah) {
  const pemilik = await buatUser();
  const grup = await buatGrup(pemilik.id);
  await buatAnggota(grup.id, pemilik.id, { role: "OWNER" });
  const ids = [];
  for (let i = 0; i < jumlah; i++) {
    ids.push((await buatTransaksi(grup.id, pemilik.id, { status: "ACTIVE", amount: 70000 })).id);
  }
  return { grup, pemilik, ids: ids.reverse() };
}

const ambilDi = (groupId) => async ({ take, kursor }) =>
  prisma.transaction.findMany({
    where: { groupId, ...(kursor === null ? {} : { id: { lt: kursor.id } }) },
    orderBy: { id: "desc" },
    take,
    select: { id: true },
  });

const halamanKe = (groupId, limit, kursor) =>
  ambilHalaman({ limit, kursor, skemaKursor, ambil: ambilDi(groupId), buatKursor });

describe("pagination kursor di SQL Server", () => {
  after(() => prisma.$disconnect());

  it("25 baris per 10: halaman 10, 10, 5; hasMore benar; tiap id sekali; terbaru dulu; grup lain tidak ikut", async () => {
    const { grup, ids } = await siapkan(25);
    await siapkan(2);
    const p1 = await halamanKe(grup.id, 10);
    const p2 = await halamanKe(grup.id, 10, p1.nextCursor);
    const p3 = await halamanKe(grup.id, 10, p2.nextCursor);
    assert.deepEqual([p1.data.length, p2.data.length, p3.data.length], [10, 10, 5]);
    assert.deepEqual([p1.hasMore, p2.hasMore, p3.hasMore], [true, true, false]);
    assert.equal(p3.nextCursor, null);
    assert.deepEqual([...p1.data, ...p2.data, ...p3.data].map((b) => b.id), ids);
  });

  it("baris baru di antara dua halaman tidak menggeser hasil", async () => {
    const { grup, pemilik, ids } = await siapkan(25);
    const p1 = await halamanKe(grup.id, 10);
    const baru = [];
    for (let i = 0; i < 3; i++) baru.push((await buatTransaksi(grup.id, pemilik.id, { status: "ACTIVE", amount: 70000 })).id);
    const p2 = await halamanKe(grup.id, 10, p1.nextCursor);
    const p3 = await halamanKe(grup.id, 10, p2.nextCursor);
    assert.deepEqual([...p1.data, ...p2.data, ...p3.data].map((b) => b.id), ids);
    const segar = await halamanKe(grup.id, 10);
    assert.deepEqual(segar.data.slice(0, 3).map((b) => b.id), baru.reverse());
  });

  it("daftar kosong dan tepat sejumlah limit", async () => {
    const kosong = await siapkan(0);
    assert.deepEqual(await halamanKe(kosong.grup.id, 5), { data: [], nextCursor: null, hasMore: false });
    const tepat = await siapkan(5);
    const hasil = await halamanKe(tepat.grup.id, 5);
    assert.equal(hasil.data.length, 5);
    assert.equal(hasil.hasMore, false);
    assert.equal(hasil.nextCursor, null);
  });
});
