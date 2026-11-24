"use strict";

// Loads dist/localtrack-cards.js through the shared test kit (tests/_testkit.cjs,
// M5/D13): its vm loader (`loadScript`), its DOM stand-in (`createDom` via
// `createEnvironment`) and, for the zone-time card, its hass stand-in
// (`createHass`). No browser, no network.
//
// The kit keeps `innerHTML` unparsed on purpose ("tests that need parsed markup
// keep their own parser"). Both cards build their skeleton with `innerHTML`
// and the XSS tests must see whether a string sink turns a friendly_name into
// elements, so this file adds exactly that on top of the kit's classes:
//
//   * `innerHTML` parses markup into kit nodes (tags, attributes, entities)
//     and reads back as serialised markup; `outerHTML` likewise;
//   * `value`/`options`/`selectedOptions` for form elements;
//   * custom element reactions: `connectedCallback`/`disconnectedCallback` run
//     when an element enters or leaves the document, as in the browser. A card
//     that is not in the document reports `isConnected === false`, so tests
//     hang a card in (`einhaengen`) the way Home Assistant does.
//
// The window is the vm global (`window === globalThis`), as in a browser:
// a test sets `k.kontext.L` or `k.kontext.setTimeout` and the card sees it.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const kit = require("./_testkit.cjs");

const KARTE = path.join(__dirname, "..", "dist", "localtrack-cards.js");

function quelle() {
  return fs.readFileSync(KARTE, "utf8");
}

/* ── Markup on top of the kit DOM ──────────────────────────────────────── */

const VOID = new Set(["img", "br", "hr", "input", "meta", "link", "source", "wbr", "col", "area", "base", "embed", "track"]);
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

function decode(text) {
  return text.replace(/&(#39|amp|lt|gt|quot|apos|nbsp);/g, (_, name) => ENTITIES[name]);
}

const escapeText = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (value) => String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/** Sets a parsed attribute and reflects the ones the kit keeps as properties. */
function applyAttribute(el, name, value) {
  el.setAttribute(name, value);
  if (name === "hidden") el.hidden = true;
  else if (name === "disabled") el.disabled = true;
  else if (name === "title") el.title = value;
  else if (name === "tabindex") el.tabIndex = Number(value);
  else if (name === "selected") el._selected = true;
}

/** Tiny HTML parser into nodes of `document`: tags, quoted/unquoted attributes, void tags, entities. */
function parseInto(document, html) {
  const root = document.createDocumentFragment();
  const stack = [root];
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>|([^<]+|<)/g;
  let m;
  while ((m = re.exec(html))) {
    const [, closing, tag, attrs, text] = m;
    const top = stack[stack.length - 1];
    if (text !== undefined) { top.appendChild(document.createTextNode(decode(text))); continue; }
    const name = tag.toLowerCase();
    if (closing) {
      const at = stack.map((n) => n.tagName).lastIndexOf(name.toUpperCase());
      if (at > 0) stack.length = at;
      continue;
    }
    const el = document.createElement(name);
    const attrRe = /([^\s=>/]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let a;
    while ((a = attrRe.exec(attrs || ""))) applyAttribute(el, a[1].toLowerCase(), decode(a[2] ?? a[3] ?? a[4] ?? ""));
    top.appendChild(el);
    if (!VOID.has(name)) stack.push(el);
  }
  return root;
}

const dashed = (key) => key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());

/** Markup of a kit node, like the browser's outerHTML. */
function serialize(node) {
  if (node.nodeType === 3) return escapeText(node.data);
  if (node.nodeType !== 1) return (node.childNodes || []).map(serialize).join("");
  const attrs = { ...node.attributes };
  if (node.className) attrs.class = node.className; else delete attrs.class;
  if (node.id) attrs.id = node.id;
  for (const [key, value] of Object.entries(node.dataset || {})) attrs["data-" + dashed(key)] = value;
  if (node.hidden === true) attrs.hidden = ""; else delete attrs.hidden;
  if (node.disabled === true) attrs.disabled = ""; else delete attrs.disabled;
  if (node.title) attrs.title = node.title;
  const tag = node.localName;
  const open = `<${tag}${Object.entries(attrs).map(([key, value]) => ` ${key}="${escapeAttr(value)}"`).join("")}>`;
  if (VOID.has(tag)) return open;
  return `${open}${node.childNodes.map(serialize).join("")}</${tag}>`;
}

const elementsOf = (node) => (node.nodeType === 1 ? [node] : []).concat(
  ...(node.childNodes || []).map(elementsOf),
  ...(node.shadowRoot ? [elementsOf(node.shadowRoot)] : []));

/** Adds parsed markup, form values and custom element reactions to one kit DOM. */
function installBrowserBits(dom) {
  const { Node, Element, ShadowRoot, document } = dom;
  // Assigning innerHTML replaces the children without calling the node's
  // insertBefore/removeChild (a test may wrap those of one element to watch
  // what the card itself inserts); the prototype methods still run the
  // custom element reactions below.
  const markup = {
    configurable: true,
    get() { return this.childNodes.map(serialize).join(""); },
    set(value) {
      for (const child of [...this.childNodes]) Node.prototype.removeChild.call(this, child);
      this._innerHTML = "";
      for (const child of [...parseInto(document, String(value)).childNodes]) Node.prototype.insertBefore.call(this, child, null);
    },
  };
  Object.defineProperty(Element.prototype, "innerHTML", markup);
  Object.defineProperty(ShadowRoot.prototype, "innerHTML", markup);
  Object.defineProperty(Element.prototype, "outerHTML", { configurable: true, get() { return serialize(this); } });

  Object.defineProperty(Node.prototype, "childElementCount", { configurable: true, get() { return this.children.length; } });

  const options = (el) => el.querySelectorAll("option");
  Object.defineProperty(Element.prototype, "options", { configurable: true, get() { return options(this); } });
  Object.defineProperty(Element.prototype, "selectedOptions", {
    configurable: true,
    get() {
      const list = options(this);
      const chosen = list.filter((o) => o.selected);
      if (chosen.length) return chosen;
      const byValue = this._value !== undefined ? list.find((o) => o.value === this._value) : null;
      return byValue ? [byValue] : list.slice(0, 1);
    },
  });
  Object.defineProperty(Element.prototype, "selected", {
    configurable: true,
    get() { return !!this._selected; },
    set(on) { this._selected = !!on; },
  });
  Object.defineProperty(Element.prototype, "value", {
    configurable: true,
    get() {
      if (this.tagName === "SELECT") {
        const [first] = this.selectedOptions;
        return first ? first.value : "";
      }
      if (this._value !== undefined) return this._value;
      if (this.tagName === "OPTION") return this.getAttribute("value") ?? this.textContent;
      return this.getAttribute("value") ?? "";
    },
    set(value) {
      this._value = String(value);
      if (this.tagName === "SELECT") for (const o of options(this)) o._selected = o.value === this._value;
    },
  });

  // Custom element reactions, as the browser runs them on insert and remove.
  const react = (node, connected) => {
    for (const el of elementsOf(node)) {
      if (connected && !el._ltConnected && el.isConnected) {
        el._ltConnected = true;
        if (typeof el.connectedCallback === "function") el.connectedCallback();
      } else if (!connected && el._ltConnected && !el.isConnected) {
        el._ltConnected = false;
        if (typeof el.disconnectedCallback === "function") el.disconnectedCallback();
      }
    }
  };
  const insertBefore = Node.prototype.insertBefore;
  const removeChild = Node.prototype.removeChild;
  Node.prototype.insertBefore = function (node, ref) {
    const kids = node && node.nodeType === 11 ? [...node.childNodes] : [node];
    const result = insertBefore.call(this, node, ref);
    if (this.isConnected) for (const kid of kids) react(kid, true);
    return result;
  };
  Node.prototype.removeChild = function (node) {
    const result = removeChild.call(this, node);
    react(node, false);
    return result;
  };
  return dom;
}

/** Parses markup into kit nodes of a fresh document; returns the top-level nodes. */
function parseHtml(html) {
  const dom = installBrowserBits(kit.createDom());
  return [...parseInto(dom.document, String(html)).childNodes];
}

/* ── Loader ────────────────────────────────────────────────────────────── */

/**
 * Loads the bundle with the kit's `loadScript` and returns the named top-level
 * bindings, plus `kontext` (the window = vm global), `env` (the kit
 * environment), `elements` (the element registry) and `karten`
 * (`window.customCards`). `sprache` sets navigator.language. Timers and `Date`
 * are real unless a test swaps them on `kontext` (for example for a kit clock).
 * `realm` (from `gemeinsamerRealm()`) lets a second load share the element
 * registry and `window.customCards` with the first, as a browser does when the
 * module is loaded from two URLs. `quelleText` loads another source text.
 */
function ladeKarte(namen, { sprache = "en-US", realm, quelleText } = {}) {
  const env = kit.createEnvironment({
    language: sprache,
    globals: {
      setTimeout, clearTimeout, setInterval, clearInterval, Date,
      // The browser has it, the kit DOM has not; a test that counts observers sets its own.
      ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    },
  });
  installBrowserBits(env);
  env.navigator.platform = "node";
  const win = env.window;
  for (const [key, value] of Object.entries(env)) if (key !== "window") win[key] = value;
  win.window = win;
  win.self = win;
  win.customCards = undefined;
  if (realm) {
    win.customElements = realm.customElements;
    Object.defineProperty(win, "customCards", {
      get: () => realm.customCards, set: (value) => { realm.customCards = value; }, configurable: true,
    });
  }
  let file = KARTE;
  let temp = null;
  if (quelleText !== undefined) {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), "localtrack-"));
    file = path.join(temp, "localtrack-cards.js");
    fs.writeFileSync(file, quelleText);
  }
  try {
    const { exposed } = kit.loadScript(file, { globals: win, expose: namen });
    const registry = win.customElements;
    return { ...exposed, elements: { get: (name) => registry.get(name), has: (name) => !!registry.get(name) },
      karten: win.customCards, kontext: win, env };
  } finally {
    if (temp) fs.rmSync(temp, { recursive: true, force: true });
  }
}

/** One browser realm for several loads: one element registry from the kit
 *  (its `define` throws on a taken name, here as NotSupportedError like
 *  `customElements.define`) and one `window.customCards`. */
function gemeinsamerRealm() {
  const dom = kit.createDom();
  const realm = { customCards: undefined, defines: 0 };
  realm.customElements = {
    define(name, type) {
      realm.defines += 1;
      try {
        dom.customElements.define(name, type);
      } catch (cause) {
        const error = new Error(`the name "${name}" has already been used with this registry`);
        error.name = "NotSupportedError";
        error.cause = cause;
        throw error;
      }
    },
    get: (name) => dom.customElements.get(name),
    whenDefined: (name) => dom.customElements.whenDefined(name),
  };
  realm.elements = { get: (name) => dom.customElements.get(name), has: (name) => !!dom.customElements.get(name) };
  return realm;
}

/** Hangs `card` into the document of its own load (`document.body`), as
 *  Home Assistant hangs a card into a dashboard; connectedCallback runs. */
function einhaengen(card) {
  card.ownerDocument.body.appendChild(card);
  return card;
}

/** Fires a bubbling DOM event of the element's own realm (input, change, …),
 *  so the card's listeners run as in the browser. */
function feuere(el, type, init = {}) {
  const { Event } = el.ownerDocument.defaultView;
  return el.dispatchEvent(new Event(type, { bubbles: true, ...init }));
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

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

/** WebSocket types of the Local Track integration the cards call. */
const WS_TYPEN = ["localtrack/history", "localtrack/stats", "localtrack/zone_time"];

/**
 * A zone-time card with config and hass set, hung into the document. hass is
 * the kit's `createHass` (`ha`, with counters per message type); `callWS(msg)`
 * answers the card's WebSocket calls, every call is recorded in `aufrufe`.
 */
function zonenKarte({ callWS, states = zustaende(), config = {}, month } = {}) {
  const k = ladeKarte(["LocaltrackZoneTimeCard", "TEXTE_LOCALTRACK_ZONE_TIME_CARD"]);
  const aufrufe = [];
  const ha = kit.createHass({ states, language: "en" });
  for (const type of WS_TYPEN) ha.respond(type, (msg) => { aufrufe.push(msg); return callWS(msg); });
  const hass = ha.hass;
  const card = new k.LocaltrackZoneTimeCard();
  if (month) card._month = month;
  card.setConfig({ entity: "person.a", zone: "zone.work", ...config });
  card.hass = hass;
  einhaengen(card);
  return { card, hass, ha, aufrufe, k, texte: k.TEXTE_LOCALTRACK_ZONE_TIME_CARD.en.texte };
}

module.exports = { ladeKarte, gemeinsamerRealm, einhaengen, feuere, zonenKarte, zustaende, ruhe, offen, quelle, parseHtml, KARTE };
