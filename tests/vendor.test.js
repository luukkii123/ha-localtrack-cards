"use strict";

// M46: the embedded Leaflet stays byte-identical to upstream 1.9.4.
// - leaflet: leaflet.js from unpkg, only the trailing sourceMappingURL line
//   removed. Same hash as in ha-busch-cards; both repos update together.
// - leaflet-css: leaflet.css and its PNGs as JS literals. Reversing the two
//   documented edits (data: URIs back to url(images/...), LF back to CRLF)
//   must give the upstream leaflet.css bytes again.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const LEAFLET_JS_SHA256 = "dc71f8a6880bc3ca1bd9fa8dc5f1af48c702dc510b0a78240a07c5feed7ce935";
const LEAFLET_CSS_BLOCK_SHA256 = "f9a4ebee365ce08681975728105b59761adf4e5c9879a9f45ae04f9dbce18e2b";
// sha256 of upstream leaflet.css 1.9.4 (SRI sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=).
const LEAFLET_CSS_UPSTREAM_SHA256 = "a7837102824184820dfa198d1ebcd109ff6d0ff9a2672a074b9a1b4d147d04c6";
// Read as latin1 so every byte maps to one char and hashes back unchanged.
const TEXT = fs.readFileSync(path.join(__dirname, "..", "dist", "localtrack-cards.js"), "latin1");

function vendorBlocks(text) {
  const re = /\/\* BEGIN VENDOR ([\w.-]+) (\S+) sha256:([0-9a-f]{64}) \*\/\n([\s\S]*?)^\/\* END VENDOR \1 \*\//gm;
  return Array.from(text.matchAll(re), (m) => ({ name: m[1], version: m[2], hash: m[3], body: m[4] }));
}

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const latin1 = (body) => Buffer.from(body, "latin1");

test("two vendor blocks, leaflet and leaflet-css 1.9.4, markers complete", () => {
  const blocks = vendorBlocks(TEXT);
  assert.deepEqual(blocks.map((b) => `${b.name} ${b.version}`), ["leaflet 1.9.4", "leaflet-css 1.9.4"]);
  assert.equal(TEXT.split("/* BEGIN VENDOR ").length - 1, 2);
  assert.equal(TEXT.split("/* END VENDOR ").length - 1, 2);
});

test("leaflet block matches the upstream hash", () => {
  const leaflet = vendorBlocks(TEXT).find((b) => b.name === "leaflet");
  assert.equal(leaflet.hash, LEAFLET_JS_SHA256);
  assert.equal(sha256(latin1(leaflet.body)), LEAFLET_JS_SHA256);
  assert.ok(leaflet.body.startsWith("/* @preserve\n * Leaflet 1.9.4, a JS library"));
  assert.ok(!leaflet.body.includes("sourceMappingURL"));
});

test("leaflet-css block matches its hash and restores upstream leaflet.css", () => {
  const css = vendorBlocks(TEXT).find((b) => b.name === "leaflet-css");
  assert.equal(css.hash, LEAFLET_CSS_BLOCK_SHA256);
  assert.equal(sha256(latin1(css.body)), LEAFLET_CSS_BLOCK_SHA256);
  const body = latin1(css.body).toString("utf8");
  const images = Object.fromEntries(
    Array.from(body.matchAll(/^\s+(\w+): "(data:image\/png;base64,[^"]+)",$/gm), (m) => [m[1], m[2]])
  );
  const files = { markerIcon: "marker-icon.png", markerIcon2x: "marker-icon-2x.png", markerShadow: "marker-shadow.png", layers: "layers.png", layers2x: "layers-2x.png" };
  assert.deepEqual(Object.keys(images).sort(), Object.keys(files).sort());
  const literal = body.match(/^const LEAFLET_CSS = (".*");$/m);
  assert.ok(literal, "LEAFLET_CSS literal inside the block");
  let restored = JSON.parse(literal[1]);
  for (const [key, uri] of Object.entries(images)) restored = restored.split(`url(${uri})`).join(`url(images/${files[key]})`);
  assert.equal(sha256(Buffer.from(restored.replace(/\n/g, "\r\n"), "utf8")), LEAFLET_CSS_UPSTREAM_SHA256);
});

test("embedded PNGs have the upstream image sizes", () => {
  const css = vendorBlocks(TEXT).find((b) => b.name === "leaflet-css");
  const sizes = { markerIcon: "25x41", markerIcon2x: "50x82", markerShadow: "41x41", layers: "26x26", layers2x: "52x52" };
  for (const m of css.body.matchAll(/^\s+(\w+): "data:image\/png;base64,([^"]+)",$/gm)) {
    const png = Buffer.from(m[2], "base64");
    assert.equal(png.subarray(1, 4).toString("latin1"), "PNG", m[1]);
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, sizes[m[1]], m[1]);
  }
});
