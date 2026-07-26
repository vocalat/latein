import test from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { safeStaticPath } from "../server.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("static file resolution maps the root and app files", () => {
  assert.equal(safeStaticPath("/"), resolve(root, "index.html"));
  assert.equal(safeStaticPath("/app.js"), resolve(root, "app.js"));
});

test("static file resolution refuses paths outside the app", () => {
  assert.equal(safeStaticPath("/../private.txt"), null);
  assert.equal(safeStaticPath("/%2e%2e/private.txt"), null);
  assert.equal(safeStaticPath("/%E0%A4%A"), null);
});
