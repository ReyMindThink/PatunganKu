import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { mulaiAplikasi } from "../helpers/http.js";
import { buatRequireAuth } from "../../src/middlewares/requireAuth.js";
import { buatRouterRingkasan } from "../../src/routes/ringkasan.router.js";

const SECRET = "rahasia-uji-router-ringkasan-yang-cukup-panjang";
const token = (id) => jwt.sign({ sub: String(id) }, SECRET, { algorithm: "HS256", expiresIn: "1h" });

describe("router ringkasan", async () => {
  const panggilan = [];
  const router = buatRouterRingkasan({ jumlahPerluSuara: async (id) => { panggilan.push(id); return 4; }, requireAuth: buatRequireAuth({ secret: SECRET }) });
  const server = await mulaiAplikasi((app) => app.use("/api/me", router));
  after(() => server.tutup());
  const minta = (path, userId, metode = "GET") =>
    fetch(server.url + "/api/me" + path, { method: metode, headers: userId === undefined ? {} : { authorization: "Bearer " + token(userId) } });

  it("hanya GET /summary; tanpa token 401 tanpa memanggil penghitung", async () => {
    assert.deepEqual(router.stack.filter((l) => l.route).map((l) => Object.keys(l.route.methods).join() + " " + l.route.path), ["get /summary"]);
    assert.equal((await minta("/summary")).status, 401);
    assert.equal((await minta("/summary", 1, "POST")).status, 404);
    assert.deepEqual(panggilan, []);
  });

  it("memberi approvalsToVote dari penghitung untuk pengguna token dan field lain 0", async () => {
    const res = await minta("/summary", 7);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { data: { unreadNotifications: 0, approvalsToVote: 4, sharesToConsent: 0, paymentsToConfirm: 0, itemsOffered: 0 } });
    assert.deepEqual(panggilan, [7]);
  });
});
