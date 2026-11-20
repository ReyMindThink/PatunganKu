import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sedangShutdown, tandaiShutdown } from "../../src/lib/statusServer.js";

describe("statusServer", () => {
  it("awalnya tidak sedang berhenti, sesudah ditandai menjadi berhenti", () => {
    assert.equal(sedangShutdown(), false);
    tandaiShutdown();
    assert.equal(sedangShutdown(), true);
  });

  it("menandai dua kali tidak mengubah hasil", () => {
    tandaiShutdown();
    tandaiShutdown();
    assert.equal(sedangShutdown(), true);
  });
});
