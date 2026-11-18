"use strict";

// Loads dist/localtrack-cards.js in a vm sandbox with a small fake DOM, after
// the pattern of busch-cards/tests/laden.js. No browser, no network.
//
// The fake DOM is just rich enough for the zone-time card. Its one real piece
// of behaviour is `innerHTML`: assigned markup is PARSED into child nodes
// (tags, attributes, entities), so a test can see whether a string sink turns
// a friendly_name into elements. `shadowRoot.querySelector` hands out one
// stub element per selector — the cards only query their own skeleton.

const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const KARTE = path.join(__dirname, "..", "dist", "localtrack-cards.js");

function quelle() {
  return fs.readFileSync(KARTE, "utf8");
}

const VOID = new Set(["img", "br", "hr", "input", "meta", "link", "source", "wbr"]);
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

function decode(text) {
  return text.replace(/&(#39|amp|lt|gt|quot|apos|nbsp);/g, (_, name) => ENTITIES[name]);
}

class FakeText {
  constructor(data) { this.nodeType = 3; this.data = data; }
  get textContent() { return this.data; }
}

class FakeElement {
  constructor(tag) {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this._kids = [];
    this._html = null;
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.className = "";
    this.listeners = {};
    const self = this;
    this.classList = {
      toggle(name, force) {
        const list = String(self.className).split(/\s+/).filter(Boolean);
        const on = force === undefined ? !list.includes(name) : !!force;
        const rest = list.filter((c) => c !== name);
        self.className = (on ? [...rest, name] : rest).join(" ");
        return on;
      },
      contains(name) { return String(self.className).split(/\s+/).includes(name); },
      add(name) { this.toggle(name, true); },
      remove(name) { this.toggle(name, false); },
    };
  }

  get childNodes() {
    if (this._html !== null) { this._kids = parseHtml(this._html); this._html = null; }
    return this._kids;
  }

  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }

  set innerHTML(html) { this._html = String(html); this._kids = []; }

  get innerHTML() { return this._html !== null ? this._html : "(nodes)"; }

  get textContent() { return this.childNodes.map((n) => n.textContent).join(""); }

  set textContent(text) { this._html = null; this._kids = [new FakeText(String(text))]; }

  get value() {
    if (this._value !== undefined) return this._value;
    const first = this.children[0];
    return first ? first.value : "";
  }

  set value(v) { this._value = String(v); }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "value") this._value = String(value);
  }

  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }

  removeAttribute(name) { delete this.attributes[name]; }

  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }

  removeEventListener() {}

  appendChild(node) { this.childNodes.push(node); return node; }

  replaceChildren(...nodes) {
    this._html = null;
    this._kids = nodes.map((n) => (typeof n === "string" ? new FakeText(n) : n));
  }

  /** All element descendants, depth first. */
  descendants() {
    const out = [];
    for (const n of this.children) out.push(n, ...n.descendants());
    return out;
  }

  /** Tag-name selectors only — enough for "is there an img?". */
  querySelectorAll(tag) {
    const wanted = String(tag).toUpperCase();
    return this.descendants().filter((n) => n.tagName === wanted);
  }

  querySelector(tag) { return this.querySelectorAll(tag)[0] || null; }
}

/** Tiny HTML parser: tags, quoted/unquoted attributes, void tags, entities. */
function parseHtml(html) {
  const root = new FakeElement("#root");
  const stack = [root];
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>|([^<]+|<)/g;
  let m;
  while ((m = re.exec(html))) {
    const [, closing, tag, attrs, text] = m;
    const top = stack[stack.length - 1];
    if (text !== undefined) { top._kids.push(new FakeText(decode(text))); continue; }
    const name = tag.toLowerCase();
    if (closing) {
      const at = stack.map((n) => n.tagName).lastIndexOf(name.toUpperCase());
      if (at > 0) stack.length = at;
      continue;
    }
    const el = new FakeElement(name);
    const attrRe = /([^\s=>/]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let a;
    while ((a = attrRe.exec(attrs || ""))) {
      el.setAttribute(a[1], decode(a[2] ?? a[3] ?? a[4] ?? ""));
    }
    top._kids.push(el);
    if (!VOID.has(name)) stack.push(el);
  }
  return root._kids;
}

class FakeShadowRoot extends FakeElement {
  constructor() { super("#shadow-root"); this._stubs = new Map(); }

  querySelector(selector) {
    if (!this._stubs.has(selector)) this._stubs.set(selector, new FakeElement("stub"));
    return this._stubs.get(selector);
  }

  querySelectorAll() { return []; }
}

class FakeHTMLElement extends FakeElement {
  constructor() { super("custom"); this.shadowRoot = null; }

  attachShadow() { this.shadowRoot = new FakeShadowRoot(); return this.shadowRoot; }

  dispatchEvent() { return true; }
}

/**
 * Loads the bundle and returns the named top-level bindings. `const` and
 * `class` do not become properties of the global object, so an expression in
 * the same scope collects them. `sprache` sets navigator.language.
 */
function ladeKarte(namen, { sprache = "en-US" } = {}) {
  const elements = new Map();
  const document = {
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (_ns, tag) => new FakeElement(tag),
    createTextNode: (text) => new FakeText(text),
    documentElement: { style: {} },
    head: new FakeElement("head"),
    addEventListener() {},
    removeEventListener() {},
  };
  const kontext = {
    console: { info() {}, warn() {}, error() {}, log() {} },
    navigator: { language: sprache, userAgent: "node", platform: "node" },
    document,
    HTMLElement: FakeHTMLElement,
    customElements: { define: (name, type) => elements.set(name, type), get: (name) => elements.get(name) },
    CustomEvent: class { constructor(type, options) { Object.assign(this, { type }, options); } },
    setTimeout, clearTimeout, setInterval, clearInterval,
    devicePixelRatio: 1,
    addEventListener() {},
    removeEventListener() {},
  };
  kontext.window = kontext;
  kontext.self = kontext;
  vm.createContext(kontext);
  const sammler = `\n;({ ${namen.join(", ")} });`;
  const geladen = vm.runInContext(quelle() + sammler, kontext, { filename: KARTE });
  return { ...geladen, elements, karten: kontext.window.customCards, kontext };
}

/** Lets every queued promise reaction run (the sandbox shares the queue). */
function ruhe() {
  return new Promise((resolve) => setImmediate(resolve));
}

/** A promise with its resolve/reject handles, for callWS stand-ins. */
function offen() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Neutral test states: two tracked people, two zones with coordinates. */
function zustaende(namen = {}) {
  const ort = (name, radius) => ({ attributes: { friendly_name: name, latitude: 50, longitude: 8, radius } });
  return {
    "person.a": { attributes: { friendly_name: namen.a ?? "Person A" } },
    "person.b": { attributes: { friendly_name: namen.b ?? "Person B" } },
    "zone.home": ort(namen.home ?? "Home", 100),
    "zone.work": ort(namen.work ?? "Work", 50),
  };
}

/**
 * A zone-time card with config and hass set. `callWS(msg)` answers the
 * card's WebSocket calls; every call is recorded in `aufrufe`.
 */
function zonenKarte({ callWS, states = zustaende(), config = {}, month } = {}) {
  const k = ladeKarte(["LocaltrackZoneTimeCard", "TEXTE_LOCALTRACK_ZONE_TIME_CARD"]);
  const aufrufe = [];
  const hass = {
    states,
    locale: { language: "en" },
    callWS: (msg) => { aufrufe.push(msg); return callWS(msg); },
  };
  const card = new k.LocaltrackZoneTimeCard();
  if (month) card._month = month;
  card.setConfig({ entity: "person.a", zone: "zone.work", ...config });
  card.hass = hass;
  return { card, hass, aufrufe, texte: k.TEXTE_LOCALTRACK_ZONE_TIME_CARD.en.texte };
}

module.exports = { ladeKarte, zonenKarte, zustaende, ruhe, offen, quelle, parseHtml, FakeElement, KARTE };
