import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bacaLabel, formatLaporan, hitungMetrik, rencanaEvaluasi, selangWilson } from "../../src/utils/evaluasiStruk.js";

const H = "berkas,struk,total";
const pesan = (hasil) => hasil.errors.join(" | ");

describe("bacaLabel: bentuk sah", () => {
  it("membaca struk dan bukan struk", () => {
    const h = bacaLabel(H + "\na.jpg,ya,45000\nb.png,tidak,\n");
    assert.equal(h.ok, true);
    assert.deepEqual(h.errors, []);
    assert.deepEqual(h.labels, [
      { berkas: "a.jpg", isReceipt: true, total: 45000 },
      { berkas: "b.png", isReceipt: false, total: null },
    ]);
  });

  it("CRLF, baris kosong, spasi, dan huruf besar pada header dan nilai diterima", () => {
    const h = bacaLabel("Berkas,Struk,Total\r\n\r\n a.jpg , YA , 100 \r\nb.png,Tidak,\r\n");
    assert.equal(h.ok, true);
    assert.deepEqual(h.labels.map((l) => [l.berkas, l.isReceipt, l.total]), [["a.jpg", true, 100], ["b.png", false, null]]);
  });

  it("total batas atas diterima, di atasnya ditolak", () => {
    assert.equal(bacaLabel(H + "\na.jpg,ya,2000000000").ok, true);
    assert.equal(bacaLabel(H + "\na.jpg,ya,2000000001").ok, false);
  });
});

describe("bacaLabel: galat", () => {
  it("header salah atau kosong", () => {
    assert.equal(bacaLabel("").ok, false);
    assert.equal(bacaLabel("nama,struk,total\na.jpg,ya,1").ok, false);
    assert.match(pesan(bacaLabel("x\na.jpg,ya,1")), /baris pertama/);
  });

  it("hanya header tanpa data ditolak", () => {
    const h = bacaLabel(H + "\n");
    assert.equal(h.ok, false);
    assert.match(pesan(h), /tidak ada baris data/);
  });

  it("jumlah kolom salah memberi nomor baris", () => {
    for (const buruk of ["a.jpg,ya", "a.jpg,ya,100,x"]) {
      const h = bacaLabel(H + "\n" + buruk);
      assert.equal(h.ok, false);
      assert.match(pesan(h), /baris 2: harus 3 kolom/);
    }
  });

  it("nama berkas kosong atau memuat garis miring ditolak", () => {
    for (const buruk of [",ya,100", "a/b.jpg,ya,100", "a\\b.jpg,ya,100", "../x.jpg,ya,100"]) {
      const h = bacaLabel(H + "\n" + buruk);
      assert.equal(h.ok, false, buruk);
      assert.match(pesan(h), /nama berkas/);
    }
  });

  it("berkas ganda tidak peka huruf", () => {
    const h = bacaLabel(H + "\na.jpg,ya,100\nA.JPG,tidak,");
    assert.equal(h.ok, false);
    assert.match(pesan(h), /baris 3: berkas ganda A.JPG/);
  });

  it("kolom struk selain ya atau tidak", () => {
    const h = bacaLabel(H + "\na.jpg,mungkin,100");
    assert.equal(h.ok, false);
    assert.match(pesan(h), /ya atau tidak/);
  });

  it("total struk harus bulat positif tanpa pemisah", () => {
    for (const buruk of ["", "0", "-5", "1.5", "45.000", "45,000", "abc", "007"]) {
      const h = bacaLabel(H + "\na.jpg,ya," + buruk);
      assert.equal(h.ok, false, "total '" + buruk + "'");
    }
  });

  it("bukan struk wajib total kosong, termasuk total satu karakter", () => {
    for (const buruk of ["5000", "5", "0"]) {
      const h = bacaLabel(H + "\nb.png,tidak," + buruk);
      assert.equal(h.ok, false, buruk);
      assert.match(pesan(h), /harus kosong/);
    }
  });

  it("semua galat dikumpulkan sekaligus dan baris sah tetap terbaca", () => {
    const h = bacaLabel(H + "\na.jpg,ya,100\nb.jpg,ya\nc.jpg,x,1\nd.jpg,tidak,");
    assert.equal(h.ok, false);
    assert.equal(h.errors.length, 2);
    assert.deepEqual(h.labels.map((l) => l.berkas), ["a.jpg", "d.jpg"]);
  });
});

describe("rencanaEvaluasi", () => {
  const labels = [
    { berkas: "a.jpg", isReceipt: true, total: 1 },
    { berkas: "b.png", isReceipt: false, total: null },
  ];

  it("semua berkas ada: ok", () => {
    const r = rencanaEvaluasi({ labels, berkasDiFolder: ["a.jpg", "b.png"], maks: 60 });
    assert.deepEqual(r, { ok: true, jumlah: 2, hilang: [], tanpaLabel: [], terlaluBanyak: false });
  });

  it("berkas berlabel yang hilang membuat tidak ok", () => {
    const r = rencanaEvaluasi({ labels, berkasDiFolder: ["a.jpg"], maks: 60 });
    assert.equal(r.ok, false);
    assert.deepEqual(r.hilang, ["b.png"]);
  });

  it("pencocokan nama tidak peka huruf di kedua arah", () => {
    const r = rencanaEvaluasi({ labels, berkasDiFolder: ["A.JPG", "B.PNG"], maks: 60 });
    assert.equal(r.ok, true);
    assert.deepEqual(r.hilang, []);
    const campur = [{ berkas: "Foto.Jpg", isReceipt: true, total: 1 }];
    const r2 = rencanaEvaluasi({ labels: campur, berkasDiFolder: ["foto.JPG", "FOTO2.png"], maks: 60 });
    assert.equal(r2.ok, true);
    assert.deepEqual(r2.hilang, []);
    assert.deepEqual(r2.tanpaLabel, ["FOTO2.png"]);
  });

  it("foto tanpa label dilaporkan, berkas bukan gambar diabaikan", () => {
    const r = rencanaEvaluasi({ labels, berkasDiFolder: ["a.jpg", "b.png", "c.jpeg", "d.WEBP", "e.txt"], maks: 60 });
    assert.equal(r.ok, true);
    assert.deepEqual(r.tanpaLabel, ["c.jpeg", "d.WEBP"]);
  });

  it("melebihi maks membuat tidak ok; tepat sama dengan maks ok", () => {
    assert.equal(rencanaEvaluasi({ labels, berkasDiFolder: ["a.jpg", "b.png"], maks: 1 }).terlaluBanyak, true);
    assert.equal(rencanaEvaluasi({ labels, berkasDiFolder: ["a.jpg", "b.png"], maks: 1 }).ok, false);
    assert.equal(rencanaEvaluasi({ labels, berkasDiFolder: ["a.jpg", "b.png"], maks: 2 }).terlaluBanyak, false);
  });

  it("tanpa label tidak ok", () => {
    assert.equal(rencanaEvaluasi({ labels: [], berkasDiFolder: ["a.jpg"], maks: 60 }).ok, false);
  });
});

describe("selangWilson", () => {
  const bulat = (s) => s.map((x) => Number(x.toFixed(3)));

  it("nilai rujukan", () => {
    assert.deepEqual(bulat(selangWilson(8, 10)), [0.49, 0.943]);
    assert.deepEqual(bulat(selangWilson(5, 10)), [0.237, 0.763]);
  });

  it("batas 0 dan 1 tidak melewati rentang", () => {
    assert.deepEqual(bulat(selangWilson(0, 10)), [0, 0.278]);
    assert.deepEqual(bulat(selangWilson(10, 10)), [0.722, 1]);
  });

  it("pembulatan desimal tidak membuat batas keluar dari 0 sampai 1", () => {
    assert.equal(selangWilson(5, 5)[1], 1);
    assert.equal(selangWilson(0, 5)[0], 0);
  });

  it("n nol memberi null", () => {
    assert.equal(selangWilson(0, 0), null);
  });

  it("sampel lebih besar memberi selang lebih sempit", () => {
    const kecil = selangWilson(9, 10);
    const besar = selangWilson(90, 100);
    assert.equal(besar[1] - besar[0] < kecil[1] - kecil[0], true);
  });
});

const struk = (berkas, total, hasil, ms = 1000) => ({ berkas, label: { isReceipt: true, total }, hasil, galat: null, ms });
const bukan = (berkas, hasil, ms = 1000) => ({ berkas, label: { isReceipt: false, total: null }, hasil, galat: null, ms });
const ya = (total, confidence = 0.9) => ({ isReceipt: true, total, confidence });
const tidak = (confidence = 0.9) => ({ isReceipt: false, total: null, confidence });

describe("hitungMetrik: isReceipt", () => {
  it("matriks kebingungan dan ukuran turunannya", () => {
    const m = hitungMetrik([
      struk("a", 100, ya(100)),
      struk("b", 100, ya(100)),
      struk("c", 100, tidak()),
      bukan("d", tidak()),
      bukan("e", tidak()),
      bukan("f", tidak()),
      bukan("g", ya(500)),
    ]);
    assert.deepEqual([m.isReceipt.tp, m.isReceipt.fn, m.isReceipt.fp, m.isReceipt.tn], [2, 1, 1, 3]);
    assert.equal(m.isReceipt.akurasi, 5 / 7);
    assert.equal(m.isReceipt.presisi, 2 / 3);
    assert.equal(m.isReceipt.recall, 2 / 3);
    assert.equal(m.dinilai, 7);
    assert.equal(m.jumlah, 7);
    assert.equal(m.galat, 0);
    assert.equal(m.isReceipt.selangAkurasi.length, 2);
  });

  it("tanpa struk berlabel: presisi dan recall null, bukan NaN", () => {
    const m = hitungMetrik([bukan("a", tidak())]);
    assert.equal(m.isReceipt.recall, null);
    assert.equal(m.isReceipt.presisi, null);
    assert.equal(m.isReceipt.akurasi, 1);
  });

  it("tanpa data: semua rasio null", () => {
    const m = hitungMetrik([]);
    assert.equal(m.isReceipt.akurasi, null);
    assert.equal(m.isReceipt.selangAkurasi, null);
    assert.equal(m.total.rasioTepat, null);
    assert.equal(m.keputusan.rasioLolos, null);
    assert.equal(m.rataKeyakinan, null);
    assert.deepEqual(m.waktu, { medianMs: null, maksMs: null });
  });
});

describe("hitungMetrik: galat panggilan", () => {
  it("baris bergalat tidak ikut dinilai tetapi dihitung", () => {
    const m = hitungMetrik([
      struk("a", 100, ya(100)),
      { berkas: "b", label: { isReceipt: true, total: 100 }, hasil: null, galat: "upstream-error", ms: 25000 },
      { berkas: "c", label: { isReceipt: false, total: null }, hasil: null, galat: "bukan-gambar-didukung", ms: 1 },
    ]);
    assert.equal(m.jumlah, 3);
    assert.equal(m.galat, 2);
    assert.equal(m.dinilai, 1);
    assert.equal(m.isReceipt.tp, 1);
    assert.equal(m.total.jumlahStruk, 1);
    assert.equal(m.waktu.maksMs, 1000);
  });
});

describe("hitungMetrik: total dan keputusan", () => {
  it("total tepat, kosong, dan salah dihitung hanya pada struk berlabel", () => {
    const m = hitungMetrik([
      struk("a", 100, ya(100)),
      struk("b", 100, ya(null)),
      struk("c", 100, ya(90)),
      struk("d", 100, tidak()),
      bukan("e", ya(100)),
    ]);
    assert.equal(m.total.jumlahStruk, 4);
    assert.equal(m.total.tepat, 1);
    assert.equal(m.total.kosong, 2);
    assert.equal(m.total.salah, 1);
    assert.equal(m.total.rasioTepat, 0.25);
    assert.equal(m.total.selang.length, 2);
  });

  it("total sama dengan label dihitung tepat walau isReceipt keliru", () => {
    const m = hitungMetrik([struk("a", 100, { isReceipt: false, total: 100, confidence: 0.9 })]);
    assert.equal(m.total.tepat, 1);
    assert.equal(m.isReceipt.fn, 1);
  });

  it("keputusan akhir memakai aturan backend dan mengumpulkan alasan", () => {
    const m = hitungMetrik([
      struk("a", 100, ya(100, 0.9)),
      struk("b", 100, ya(100, 0.6)),
      struk("c", 100, ya(100, 0.59)),
      struk("d", 100, tidak(0.9)),
      struk("e", 100, ya(null, 0.9)),
      struk("f", 100, ya(90, 0.9)),
      bukan("g", ya(100, 0.9)),
    ]);
    assert.equal(m.keputusan.dari, 6);
    assert.equal(m.keputusan.lolos, 2);
    assert.equal(m.keputusan.rasioLolos, 2 / 6);
    assert.deepEqual(m.keputusan.alasan, { ok: 2, "low-confidence": 1, "not-a-receipt": 1, "total-unreadable": 1, "total-mismatch": 1 });
  });
});

describe("hitungMetrik: waktu dan keyakinan", () => {
  it("median ganjil, genap (dibulatkan), dan maksimum", () => {
    const ganjil = hitungMetrik([struk("a", 1, ya(1), 300), struk("b", 1, ya(1), 100), struk("c", 1, ya(1), 200)]);
    assert.deepEqual(ganjil.waktu, { medianMs: 200, maksMs: 300 });
    const genap = hitungMetrik([struk("a", 1, ya(1), 100), struk("b", 1, ya(1), 201), struk("c", 1, ya(1), 400), struk("d", 1, ya(1), 50)]);
    assert.deepEqual(genap.waktu, { medianMs: 151, maksMs: 400 });
  });

  it("ms yang bukan bilangan diabaikan", () => {
    const m = hitungMetrik([struk("a", 1, ya(1), null), struk("b", 1, ya(1), 400), struk("c", 1, ya(1), 200)]);
    assert.deepEqual(m.waktu, { medianMs: 300, maksMs: 400 });
    const kosong = hitungMetrik([struk("a", 1, ya(1), null)]);
    assert.deepEqual(kosong.waktu, { medianMs: null, maksMs: null });
  });

  it("rata-rata keyakinan hanya dari baris dinilai", () => {
    const m = hitungMetrik([
      struk("a", 1, ya(1, 0.5)),
      struk("b", 1, ya(1, 1)),
      { berkas: "c", label: { isReceipt: true, total: 1 }, hasil: null, galat: "x", ms: 5 },
    ]);
    assert.equal(m.rataKeyakinan, 0.75);
  });

  it("input tidak diubah", () => {
    const baris = [struk("a", 100, ya(100))];
    const salinan = JSON.stringify(baris);
    hitungMetrik(baris);
    assert.equal(JSON.stringify(baris), salinan);
  });
});

describe("formatLaporan", () => {
  const m = hitungMetrik([
    struk("a", 100, ya(100)),
    struk("b", 100, ya(90)),
    bukan("c", tidak()),
    { berkas: "d", label: { isReceipt: true, total: 1 }, hasil: null, galat: "x", ms: 9 },
  ]);

  it("memuat peringatan sampel kecil, model, hitungan, dan angka berkoma Indonesia", () => {
    const teks = formatLaporan(m, { model: "model-uji" });
    assert.match(teks, /BUKAN akurasi model tim/);
    assert.match(teks, /Model: model-uji \| berkas: 4, dinilai: 3, galat panggilan: 1/);
    assert.match(teks, /TP 2, FN 0, FP 0, TN 1/);
    assert.match(teks, /Total struk: tepat 1 dari 2 \(50,0%/);
    assert.match(teks, /lolos 1 dari 2 \(50,0%\); alasan: ok=1, total-mismatch=1/);
    assert.match(teks, /sampel kecil, selang kepercayaan lebar/);
    assert.equal(teks.split("\n").length, 7);
  });

  it("alasan diurutkan menurut abjad, bukan menurut kemunculan", () => {
    const urut = hitungMetrik([struk("a", 100, ya(90)), struk("b", 100, ya(100)), struk("c", 100, tidak())]);
    assert.match(formatLaporan(urut), /alasan: not-a-receipt=1, ok=1, total-mismatch=1/);
  });

  it("model bawaan dan data kosong memakai tanda strip", () => {
    const teks = formatLaporan(hitungMetrik([]));
    assert.match(teks, /Model: tidak diketahui/);
    assert.match(teks, /akurasi - \(selang 95%: -\)/);
    assert.match(teks, /alasan: -/);
    assert.match(teks, /median -, maksimum -/);
  });

  it("waktu ditulis dengan satuan ms", () => {
    assert.match(formatLaporan(m), /median 1000 ms, maksimum 1000 ms/);
  });
});
