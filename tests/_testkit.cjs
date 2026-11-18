// BUSCH SHARED TESTKIT 1.1.0 sha256:e19b141c837e60ccdbce6b2b5b49e3e541d189541b1b012cac80c9e3f8afa3c4 generated from shared-ui/testkit.cjs by scripts/sync-shared-ui.py; edit the source, not this copy
'use strict';
/* Busch shared Node test kit 1.1.0 (#1273, M5; #1280, M19).
 *
 * One source for the card repos' `node --test` suites, synced verbatim into
 * `tests/_testkit.cjs` of each card repo by scripts/sync-shared-ui.py. Edit
 * this file in the hacs repo, never the copies. No dependencies besides Node.
 *
 *   createClock()         virtual time: setTimeout/setInterval/Date/rAF run only on advance()
 *   createDom()           small DOM stand-in (elements, shadow roots, events, focus, selectors)
 *   createEnvironment()   clock + DOM + console as vm sandbox globals
 *   loadScript()          runs a card bundle in a vm sandbox and exposes top-level names
 *   createHass()          hass stand-in with per-type delay/reject/hang, subscriptions,
 *                         reconnect, delayed state echo, and counters per message type and bytes
 *   XSS_PAYLOADS          shared XSS payloads for every text field of a card (S5.1)
 *   activeMarkup()        img/svg/script elements and on* attributes in markup or a DOM tree
 *
 * Old repo mocks stay until a test that uses them is touched anyway.
 */
const fs = require('node:fs');
const vm = require('node:vm');

const TESTKIT_VERSION = '1.1.0';

/* ── Clock ─────────────────────────────────────────────────────────────── */

/** Drains every queued microtask, also those of vm sandboxes (same queue). */
function flush(rounds = 3) {
  let chain = Promise.resolve();
  for (let i = 0; i < rounds; i++) chain = chain.then(() => new Promise((resolve) => setImmediate(resolve)));
  return chain;
}

function createClock(start = 1_800_000_000_000) {
  let now = start, seq = 0;
  const timers = new Map();
  const add = (fn, ms, args, every) => {
    const id = ++seq, delay = Math.max(0, Number(ms) || 0);
    timers.set(id, { at: now + delay, fn, args, every: every ? Math.max(1, delay) : 0, seq: id });
    return id;
  };
  const RealDate = Date;
  class ClockDate extends RealDate {
    constructor(...args) { if (args.length) super(...args); else super(now); }
    static now() { return now; }
  }
  const clock = {
    get now() { return now; },
    Date: ClockDate,
    setTimeout: (fn, ms, ...args) => add(fn, ms, args, false),
    clearTimeout: (id) => { timers.delete(id); },
    setInterval: (fn, ms, ...args) => add(fn, ms, args, true),
    clearInterval: (id) => { timers.delete(id); },
    requestAnimationFrame: (fn) => add(() => fn(now), 16, [], false),
    cancelAnimationFrame: (id) => { timers.delete(id); },
    /** Number of armed timers and intervals. */
    pending: () => timers.size,
    flush,
    /** Lets `ms` pass: due timers fire in time order, microtasks drain after each. */
    async advance(ms = 0) {
      const target = now + Math.max(0, Number(ms) || 0);
      await flush();
      for (;;) {
        let next = null;
        for (const [id, t] of timers) if (t.at <= target && (!next || t.at < next[1].at || (t.at === next[1].at && t.seq < next[1].seq))) next = [id, t];
        if (!next) break;
        const [id, t] = next;
        now = t.at;
        if (t.every) t.at += t.every; else timers.delete(id);
        t.fn(...t.args);
        await flush();
      }
      now = target;
      await flush();
    },
  };
  return clock;
}

/* ── DOM stand-in ──────────────────────────────────────────────────────── */

function camel(name) { return name.replace(/-(\w)/g, (_, c) => c.toUpperCase()); }

/** Matches one compound selector: tag, #id, .class, [attr] and [attr="v"], `:pseudo` ignored. */
function matchesCompound(el, selector) {
  if (!el || el.nodeType !== 1) return false;
  const re = /([#.]?)([\w-]+)|\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]|:[\w-]+(?:\([^)]*\))?|\*/g;
  let m, any = false;
  while ((m = re.exec(selector))) {
    any = true;
    if (m[0] === '*' || m[0].startsWith(':')) continue;
    if (m[3] !== undefined) {
      const value = el.getAttribute(m[3]);
      if (value === null || (m[4] !== undefined && value !== m[4])) return false;
    } else if (m[1] === '#') { if (el.id !== m[2]) return false; }
    else if (m[1] === '.') { if (!el.classList.contains(m[2])) return false; }
    else if (el.tagName !== m[2].toUpperCase()) return false;
  }
  return any;
}

/** Descendant combinators (space) and selector lists (comma); `>` is treated as descendant. */
function matchesSelector(el, selector) {
  return String(selector).split(',').some((one) => {
    const parts = one.replace(/>/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (!parts.length || !matchesCompound(el, parts.at(-1))) return false;
    let node = el.parentNode, i = parts.length - 2;
    while (i >= 0 && node) { if (matchesCompound(node, parts[i])) i--; node = node.parentNode; }
    return i < 0;
  });
}

function createDom({ language = 'en' } = {}) {
  const registry = new Map(), waiting = new Map();
  let documentRef;

  class Event {
    constructor(type, init = {}) {
      this.type = type; this.bubbles = !!init.bubbles; this.composed = !!init.composed; this.cancelable = !!init.cancelable;
      this.defaultPrevented = false; this.target = null; this.currentTarget = null; this._stopped = false;
      for (const [k, v] of Object.entries(init)) if (!(k in this)) this[k] = v;
    }
    preventDefault() { if (this.cancelable !== false) this.defaultPrevented = true; }
    stopPropagation() { this._stopped = true; }
    stopImmediatePropagation() { this._stopped = true; }
  }
  class CustomEvent extends Event { constructor(type, init = {}) { super(type, init); this.detail = init.detail; } }
  class KeyboardEvent extends Event {}
  class PointerEvent extends Event {}

  class ClassList {
    constructor(el) { this.el = el; }
    _list() { return String(this.el.className || '').split(/\s+/).filter(Boolean); }
    contains(c) { return this._list().includes(c); }
    add(...c) { const l = this._list(); for (const x of c) if (!l.includes(x)) l.push(x); this.el.className = l.join(' '); }
    remove(...c) { this.el.className = this._list().filter((x) => !c.includes(x)).join(' '); }
    toggle(c, on) { const want = on === undefined ? !this.contains(c) : !!on; if (want) this.add(c); else this.remove(c); return want; }
  }

  class Node {
    constructor() { this.parentNode = null; this.childNodes = []; this.listeners = {}; }
    get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
    get firstChild() { return this.childNodes[0] || null; }
    get lastChild() { return this.childNodes.at(-1) || null; }
    get firstElementChild() { return this.children[0] || null; }
    get nextSibling() { const s = this.parentNode?.childNodes; return s ? s[s.indexOf(this) + 1] || null : null; }
    get previousSibling() { const s = this.parentNode?.childNodes; return s ? s[s.indexOf(this) - 1] || null : null; }
    get textContent() { return this.childNodes.map((n) => n.textContent).join(''); }
    set textContent(value) { this.replaceChildren(); if (value !== '' && value != null) this.appendChild(new Text(String(value))); }
    appendChild(node) { return this.insertBefore(node, null); }
    insertBefore(node, ref) {
      if (node instanceof DocumentFragment) { for (const c of [...node.childNodes]) this.insertBefore(c, ref); return node; }
      if (node.parentNode) node.parentNode.removeChild(node);
      const i = ref ? this.childNodes.indexOf(ref) : -1;
      if (i < 0) this.childNodes.push(node); else this.childNodes.splice(i, 0, node);
      node.parentNode = this;
      return node;
    }
    removeChild(node) { const i = this.childNodes.indexOf(node); if (i >= 0) this.childNodes.splice(i, 1); node.parentNode = null; return node; }
    replaceChild(next, old) { this.insertBefore(next, old); return this.removeChild(old); }
    append(...nodes) { for (const n of nodes) this.appendChild(typeof n === 'string' ? new Text(n) : n); }
    prepend(...nodes) { const first = this.firstChild; for (const n of nodes) this.insertBefore(typeof n === 'string' ? new Text(n) : n, first); }
    replaceChildren(...nodes) { for (const c of [...this.childNodes]) this.removeChild(c); this.append(...nodes); }
    remove() { this.parentNode?.removeChild(this); }
    contains(node) { for (let n = node; n; n = n.parentNode) if (n === this) return true; return false; }
    getRootNode() { let n = this; while (n.parentNode) n = n.parentNode; return n; }
    get isConnected() {
      let n = this;
      for (;;) { while (n.parentNode) n = n.parentNode; if (n === documentRef) return true; if (n instanceof ShadowRoot && n.host) n = n.host; else return false; }
    }
    /** Every element below this node (shadow roots are not entered, as in the browser). */
    descendants() { return this.childNodes.flatMap((n) => (n.nodeType === 1 ? [n, ...n.descendants()] : [])); }
    querySelectorAll(selector) { return this.descendants().filter((n) => matchesSelector(n, selector)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    getElementById(id) { return this.descendants().find((n) => n.id === id) || null; }
    addEventListener(type, fn, options) { if (!fn) return; const capture = options === true || !!options?.capture; (this.listeners[type] ||= []).push({ fn, capture, once: !!options?.once }); }
    removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((l) => l.fn !== fn); }
    /** Calls listeners in place, then bubbles up through parents and (composed) shadow hosts. */
    dispatchEvent(event) {
      if (!event.target) event.target = this;
      const path = [];
      for (let n = this; n; ) { path.push(n); if (n.parentNode) n = n.parentNode; else if (n instanceof ShadowRoot && event.composed) n = n.host; else n = null; }
      if (path.at(-1) === documentRef && documentRef.defaultView) path.push(documentRef.defaultView);
      const run = (node) => {
        for (const l of [...(node.listeners[event.type] || [])]) {
          event.currentTarget = node;
          if (l.once) node.removeEventListener(event.type, l.fn);
          typeof l.fn === 'function' ? l.fn.call(node, event) : l.fn.handleEvent(event);
        }
      };
      run(this);
      if (event.bubbles) for (const n of path.slice(1)) { if (event._stopped) break; run(n); }
      return !event.defaultPrevented;
    }
  }
  class Text extends Node {
    constructor(data = '') { super(); this.nodeType = 3; this.data = String(data); }
    get textContent() { return this.data; }
    set textContent(v) { this.data = String(v); }
  }
  class DocumentFragment extends Node { constructor() { super(); this.nodeType = 11; } }

  class Element extends Node {
    constructor(tag = 'div') {
      super();
      this.nodeType = 1; this.tagName = String(tag).toUpperCase(); this.attributes = {}; this.dataset = {}; this.className = ''; this.id = '';
      this.hidden = false; this.disabled = false; this.title = ''; this.tabIndex = -1; this.shadowRoot = null; this._innerHTML = '';
      const style = {}; style.setProperty = (k, v) => { style[k] = String(v); }; style.getPropertyValue = (k) => style[k] || ''; style.removeProperty = (k) => { delete style[k]; };
      this.style = style; this.classList = new ClassList(this);
    }
    get localName() { return this.tagName.toLowerCase(); }
    get nodeName() { return this.tagName; }
    get ownerDocument() { return documentRef; }
    /** Stores markup without parsing it; tests that need parsed markup keep their own parser. */
    get innerHTML() { return this._innerHTML; }
    set innerHTML(value) { this.replaceChildren(); this._innerHTML = String(value); }
    setAttribute(k, v) {
      v = String(v); this.attributes[k] = v;
      if (k === 'class') this.className = v; else if (k === 'id') this.id = v; else if (k.startsWith('data-')) this.dataset[camel(k.slice(5))] = v;
    }
    getAttribute(k) {
      if (k === 'class') return this.className || (this.attributes.class ?? null);
      if (k === 'id') return this.id || null;
      if (k.startsWith('data-') && this.dataset[camel(k.slice(5))] !== undefined) return String(this.dataset[camel(k.slice(5))]);
      return k in this.attributes ? this.attributes[k] : null;
    }
    hasAttribute(k) { return this.getAttribute(k) !== null; }
    removeAttribute(k) { delete this.attributes[k]; if (k === 'class') this.className = ''; if (k.startsWith('data-')) delete this.dataset[camel(k.slice(5))]; }
    toggleAttribute(k, on) { const want = on === undefined ? !this.hasAttribute(k) : !!on; if (want) this.setAttribute(k, ''); else this.removeAttribute(k); return want; }
    matches(selector) { return matchesSelector(this, selector); }
    closest(selector) { for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (n.matches(selector)) return n; return null; }
    attachShadow(init = {}) { this.shadowRoot = new ShadowRoot(this, init.mode); return this.shadowRoot; }
    /** Focus as in the browser: a disabled control refuses it; the root node remembers it. */
    focus() { if (this.disabled) return; const root = this.getRootNode(); const previous = root._active; root._active = this; if (root instanceof ShadowRoot && root.host) root.host.focus(); else if (root === documentRef) documentRef._active = this; if (previous !== this) this.dispatchEvent(new Event('focus')); }
    blur() { const root = this.getRootNode(); if (root._active === this) { root._active = null; this.dispatchEvent(new Event('blur')); } }
    click() { if (!this.disabled) this.dispatchEvent(new Event('click', { bubbles: true, composed: true })); }
    getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40 }; }
    scrollIntoView() {}
  }
  class ShadowRoot extends DocumentFragment {
    constructor(host, mode = 'open') { super(); this.host = host; this.mode = mode; this._active = null; }
    get activeElement() { return this._active && this.contains(this._active) ? this._active : null; }
    get innerHTML() { return this._innerHTML || ''; }
    set innerHTML(value) { this.replaceChildren(); this._innerHTML = String(value); }
  }
  class HTMLElement extends Element { constructor() { super('div'); } }
  class Template extends Element { constructor() { super('template'); this.content = new DocumentFragment(); } }

  const customElements = {
    define(name, type) { if (registry.has(name)) throw new Error(`${name} already defined`); registry.set(name, type); for (const fn of waiting.get(name) || []) fn(type); waiting.delete(name); },
    get: (name) => registry.get(name),
    whenDefined: (name) => (registry.has(name) ? Promise.resolve(registry.get(name)) : new Promise((resolve) => (waiting.get(name) || waiting.set(name, []).get(name)).push(resolve))),
  };

  class Document extends Node {
    constructor() { super(); this.nodeType = 9; this._active = null; this.documentElement = new Element('html'); this.body = new Element('body'); this.head = new Element('head'); this.appendChild(this.documentElement); this.documentElement.append(this.head, this.body); this.hidden = false; this.visibilityState = 'visible'; }
    get activeElement() { return this._active && this.contains(this._active) ? this._active : this.body; }
    set activeElement(value) { this._active = value; }
    createElement(tag) {
      const name = String(tag).toLowerCase(), type = registry.get(name);
      if (type) { const el = new type(); el.tagName = name.toUpperCase(); return el; }
      return name === 'template' ? new Template() : new Element(name);
    }
    createElementNS(_ns, tag) { return new Element(tag); }
    createTextNode(text) { return new Text(text); }
    createDocumentFragment() { return new DocumentFragment(); }
    /** Sets `hidden`/`visibilityState` and fires `visibilitychange` like a tab switch. */
    setHidden(hidden) { this.hidden = !!hidden; this.visibilityState = hidden ? 'hidden' : 'visible'; this.dispatchEvent(new Event('visibilitychange')); }
  }
  const document = documentRef = new Document();
  const window = new Node();
  Object.assign(window, { document, customCards: [], innerWidth: 1024, innerHeight: 768, devicePixelRatio: 1, location: { href: 'http://localhost/', pathname: '/', search: '', hash: '' } });
  window.matchMedia = (query) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  window.getComputedStyle = (el) => ({ getPropertyValue: (k) => el?.style?.[k] || '' });
  document.defaultView = window;
  const navigator = { language, languages: [language], userAgent: 'busch-testkit' };
  return { window, document, navigator, customElements, Node, Text, Element, HTMLElement, ShadowRoot, DocumentFragment, Event, CustomEvent, KeyboardEvent, PointerEvent };
}

/** DOM + clock + console as one object of sandbox globals for loadScript(). */
function createEnvironment({ clock = createClock(), language = 'en', globals = {} } = {}) {
  const dom = createDom({ language });
  const logs = [];
  const log = (level) => (...args) => logs.push({ level, args });
  const env = {
    ...dom, clock, logs,
    console: { log: log('log'), info: log('info'), warn: log('warn'), error: log('error'), debug: log('debug') },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, setInterval: clock.setInterval, clearInterval: clock.clearInterval,
    requestAnimationFrame: clock.requestAnimationFrame, cancelAnimationFrame: clock.cancelAnimationFrame, Date: clock.Date,
    queueMicrotask, structuredClone, URL, URLSearchParams, Intl, TextEncoder, TextDecoder, AbortController,
    ...globals,
  };
  Object.assign(dom.window, { setTimeout: env.setTimeout, clearTimeout: env.clearTimeout, setInterval: env.setInterval, clearInterval: env.clearInterval, requestAnimationFrame: env.requestAnimationFrame, cancelAnimationFrame: env.cancelAnimationFrame, navigator: env.navigator, customElements: env.customElements });
  return env;
}

/* ── Loader ────────────────────────────────────────────────────────────── */

/**
 * Runs `file` in a fresh vm context made of `globals` (default: a new
 * environment). `expose` names top-level const/let/class/function bindings to
 * return; they are collected by an expression in the same scope, since
 * top-level `const`/`class` never become properties of the global object.
 * `epilogue` runs in that scope too (for example to preset a module `let`).
 */
function loadScript(file, { expose = [], globals, epilogue = '' } = {}) {
  const context = globals || createEnvironment();
  if (context.window && context.window !== context) {
    for (const key of Object.keys(context.window)) if (!(key in context)) context[key] = context.window[key];
  }
  context.globalThis = context;
  if (context.window && typeof context.window === 'object') context.window.globalThis = context;
  vm.createContext(context);
  const source = fs.readFileSync(file, 'utf8');
  const tail = (epilogue ? `\n;${epilogue}\n` : '') + `\n;({ ${expose.join(', ')} });`;
  const exposed = vm.runInContext(source + tail, context, { filename: file });
  return { context, exposed };
}

/* ── hass stand-in ─────────────────────────────────────────────────────── */

const REGISTRIES = { entity: 'entities', device: 'devices', area: 'areas', floor: 'floors', label: 'labels' };
const bytes = (value) => { try { return value === undefined ? 0 : Buffer.byteLength(JSON.stringify(value)); } catch { return 0; } };
const rows = (value) => (Array.isArray(value) ? value : Object.values(value || {}));

/**
 * A `hass` that behaves like the frontend's: every state change makes a new
 * `hass` object with a new `states` object, and fires `state_changed` to
 * `connection.subscribeEvents` subscribers.
 *
 * Network behaviour is set per key with `behave(key, opts)` (every call) or
 * `behaveOnce(key, opts)` (next call): `{ delay: ms, reject: error, hang: true }`.
 * A response is computed when the request arrives and delivered later, so a
 * delayed read carries the server state of its start time. A hung call waits
 * until `release(key)`; never released, it hangs forever.
 *
 * Keys: WS message type (`get_states`, `config/entity_registry/list`, …),
 * `call_service` or `<domain>.<service>`, `call_api` or `<METHOD> <path>`,
 * `subscribe_events` or `subscribe_events:<event_type>`, and the type of a
 * `subscribeMessage` message.
 *
 * Counters: `stats.count[key]`, `stats.bytesOut[key]`, `stats.bytesIn[key]`
 * (JSON bytes of request and response); `log` keeps every call in order;
 * `entry.id` (at request) and `entry.doneSeq` (at answer) share one sequence,
 * so a test can prove that a read started after a write was answered.
 *
 * State echo: `echo(call, controller)` may return `{ entity_id: patch }` for a
 * service call; the patch is applied `echoDelay` ms after the call arrived,
 * independent of when the call's own answer is delivered.
 */
function createHass(options = {}) {
  const {
    states = {}, entities = {}, devices = {}, areas = {}, floors = {}, labels = {},
    language = 'en', user = { id: 'user', name: 'Test', is_admin: true }, clock = null,
    echoDelay = 0, echo = null, extra = {},
  } = options;
  const timer = clock ? clock.setTimeout : setTimeout;
  const now = () => (clock ? clock.now : Date.now());
  const handlers = new Map(), persistent = new Map(), once = new Map(), held = [];
  const eventSubs = new Set(), messageSubs = new Set(), connectionListeners = {}, updateListeners = new Set();
  const stats = { count: {}, bytesOut: {}, bytesIn: {}, inFlight: 0 };
  const log = [], services = [];
  let seq = 0, current;
  const server = {
    states: Object.fromEntries(Object.entries(states).map(([id, s]) => [id, stamp(id, s)])),
    entities: { ...entities }, devices: { ...devices }, areas: { ...areas }, floors: { ...floors }, labels: { ...labels },
  };

  function stamp(id, s) {
    const iso = new Date(now()).toISOString();
    return { entity_id: id, state: 'unknown', attributes: {}, last_changed: iso, last_updated: iso, context: { id: `ctx${++seq}` }, ...s };
  }
  function bump(map, key, n) { map[key] = (map[key] || 0) + n; }
  function behaviour(keys) {
    for (const key of keys) { const q = once.get(key); if (q?.length) return q.shift(); }
    for (const key of keys) if (persistent.has(key)) return persistent.get(key);
    return {};
  }
  /** Counts one request under every key, computes the answer now, delivers it as configured. */
  function request(kind, keys, message, compute) {
    const entry = { id: ++seq, kind, type: keys[0], message, at: now(), done: null };
    log.push(entry);
    for (const key of keys) { bump(stats.count, key, 1); bump(stats.bytesOut, key, bytes(message)); }
    const how = behaviour(keys);
    let result, error;
    if (how.reject !== undefined) error = how.reject;
    else { try { result = compute(); } catch (e) { error = e; } }
    stats.inFlight++;
    return new Promise((resolve, reject) => {
      const deliver = (override) => {
        stats.inFlight--; entry.done = now(); entry.doneSeq = ++seq;
        if (override && 'reject' in override) { reject(override.reject); return; }
        if (override && 'value' in override) result = override.value;
        Promise.resolve(result).then((value) => {
          for (const key of keys) bump(stats.bytesIn, key, bytes(value));
          if (error !== undefined) reject(error); else resolve(value);
        }, reject);
      };
      if (how.hang) held.push({ keys, deliver, entry });
      else if (how.delay > 0) timer(deliver, how.delay);
      else Promise.resolve().then(() => deliver());
    });
  }
  function commandError(code, message) { const e = new Error(message); e.code = code; return e; }
  function wsAnswer(message) {
    const handler = handlers.get(message.type);
    if (handler) return handler(message, controller);
    if (message.type === 'get_states') return Object.values(server.states);
    const reg = /^config\/(\w+)_registry\/list$/.exec(message.type);
    if (reg && REGISTRIES[reg[1]]) return rows(server[REGISTRIES[reg[1]]]);
    if (message.type === 'auth/current_user') return user;
    throw commandError('unknown_command', `Unknown command: ${message.type}`);
  }

  function rebuild() {
    current = {
      states: { ...server.states }, entities: server.entities, devices: server.devices, areas: server.areas, floors: server.floors,
      labels: server.labels, user, language, locale: { language, number_format: 'language', time_format: 'language' },
      config: { unit_system: { temperature: '°C', length: 'km' }, time_zone: 'UTC', components: [] },
      themes: { darkMode: false }, connection, localize: (key) => key,
      callWS: (message) => request('ws', [message.type], message, () => wsAnswer(message)),
      callService: (domain, service, data = {}, target) => {
        const call = { domain, service, data, target, at: now() };
        services.push(call);
        const message = { type: 'call_service', domain, service, service_data: data, ...(target ? { target } : {}) };
        return request('service', [`${domain}.${service}`, 'call_service'], message, () => {
          const handler = handlers.get(`${domain}.${service}`) || handlers.get('call_service');
          const value = handler ? handler(call, controller) : { context: { id: `ctx${++seq}` } };
          if (echo) {
            const patch = echo(call, controller);
            if (patch) timer(() => { for (const [id, p] of Object.entries(patch)) controller.patchState(id, p); }, echoDelay);
          }
          return value;
        });
      },
      callApi: (method, path, body) => {
        const key = `${String(method).toUpperCase()} ${path}`;
        return request('api', [key, 'call_api'], { method, path, body }, () => {
          const handler = handlers.get(key) || handlers.get('call_api');
          if (!handler) throw commandError('not_found', `No API handler: ${key}`);
          return handler({ method, path, body }, controller);
        });
      },
      ...extra,
    };
    for (const fn of [...updateListeners]) fn(current);
    return current;
  }

  const connection = {
    subscribeEvents(callback, eventType) {
      const keys = eventType ? [`subscribe_events:${eventType}`, 'subscribe_events'] : ['subscribe_events'];
      return request('subscribe', keys, { type: 'subscribe_events', ...(eventType ? { event_type: eventType } : {}) }, () => {
        const sub = { callback, eventType };
        eventSubs.add(sub);
        return () => { if (eventSubs.delete(sub)) bump(stats.count, 'unsubscribe_events', 1); return Promise.resolve(); };
      });
    },
    subscribeMessage(callback, message) {
      return request('subscribe', [message.type], message, () => {
        const sub = { callback, message };
        messageSubs.add(sub);
        return () => { if (messageSubs.delete(sub)) bump(stats.count, 'unsubscribe_events', 1); return Promise.resolve(); };
      });
    },
    sendMessagePromise: (message) => current.callWS(message),
    addEventListener(type, fn) { (connectionListeners[type] ||= new Set()).add(fn); },
    removeEventListener(type, fn) { connectionListeners[type]?.delete(fn); },
    get connected() { return controller.connected; },
  };

  const controller = {
    get hass() { return current; },
    server, stats, log, services, connected: true,
    /** Answers a WS type, `<domain>.<service>` or `<METHOD> <path>` with `fn(message, controller)`. */
    respond(key, fn) { handlers.set(key, typeof fn === 'function' ? fn : () => fn); return controller; },
    behave(key, how) { if (how) persistent.set(key, how); else persistent.delete(key); return controller; },
    behaveOnce(key, how) { (once.get(key) || once.set(key, []).get(key)).push(how); return controller; },
    /** Delivers the oldest hung call of `key` (optionally with `{ value }` or `{ reject }`); returns false if none. */
    release(key, override) { const i = held.findIndex((h) => h.keys.includes(key)); if (i < 0) return false; held.splice(i, 1)[0].deliver(override); return true; },
    held: (key) => held.filter((h) => !key || h.keys.includes(key)).length,
    count: (key) => stats.count[key] || 0,
    countMatching: (re) => Object.entries(stats.count).filter(([k]) => re.test(k)).reduce((n, [, v]) => n + v, 0),
    resetStats() { for (const k of ['count', 'bytesOut', 'bytesIn']) stats[k] = {}; log.length = 0; services.length = 0; },
    /** Replaces a state (null removes it), makes a new hass and fires state_changed. */
    setState(id, next) {
      const old = server.states[id] || null;
      const value = next == null ? null : stamp(id, { ...next, context: { id: `ctx${++seq}` } });
      if (value) server.states[id] = value; else delete server.states[id];
      controller.fireEvent('state_changed', { entity_id: id, old_state: old, new_state: value });
      return rebuild();
    },
    /** Merges `{ state, attributes }` into the current state. */
    patchState(id, patch) {
      const old = server.states[id] || stamp(id, {});
      return controller.setState(id, { ...old, ...patch, attributes: { ...old.attributes, ...(patch.attributes || {}) } });
    },
    /** Replaces registry rows (`entity`, `device`, …), makes a new hass and fires `<name>_registry_updated`. */
    setRegistry(name, value, data = { action: 'update' }) { server[REGISTRIES[name]] = value; controller.fireEvent(`${name}_registry_updated`, data); return rebuild(); },
    fireEvent(eventType, data) {
      const event = { event_type: eventType, data, origin: 'LOCAL', time_fired: new Date(now()).toISOString() };
      for (const sub of [...eventSubs]) if (!sub.eventType || sub.eventType === eventType) sub.callback(event);
    },
    /** Sends `payload` to every subscribeMessage subscriber of message type `type`. */
    pushMessage(type, payload) { for (const sub of [...messageSubs]) if (sub.message.type === type) sub.callback(payload); },
    subscriptions: (eventType) => [...eventSubs].filter((s) => eventType === undefined || s.eventType === eventType).length + (eventType === undefined ? messageSubs.size : 0),
    emitConnection(type) { for (const fn of [...(connectionListeners[type] || [])]) fn(connection, type); },
    disconnect() { controller.connected = false; controller.emitConnection('disconnected'); },
    /** `disconnected` then `ready`, like home-assistant-js-websocket after a socket drop; subscriptions survive. */
    reconnect() { if (controller.connected) controller.disconnect(); controller.connected = true; controller.emitConnection('ready'); },
    onUpdate(fn) { updateListeners.add(fn); return () => updateListeners.delete(fn); },
    connection,
  };
  rebuild();
  return controller;
}

/* ── XSS probes (M19) ──────────────────────────────────────────────────── */

/** One payload per attack shape (S5.1); put each into every text field a card renders. */
const XSS_PAYLOADS = Object.freeze([
  '<img src=x onerror=alert(1)>',
  '"><svg onload=alert(1)>',
  "'",
  '`',
  '&amp;',
  'javascript:alert(1)',
  '</option></select><img src=x onerror=alert(1)>',
]);

const ACTIVE_TAGS = new Set(['img', 'svg', 'script']);

/** Findings in a markup string: 'img', 'svg', 'script' per element and '<tag>[on…]' per handler attribute. */
function activeInMarkup(html) {
  const found = [];
  for (const tag of String(html).matchAll(/<([a-zA-Z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g)) {
    const name = tag[1].toLowerCase();
    if (ACTIVE_TAGS.has(name)) found.push(name);
    for (const attr of tag[2].matchAll(/([^\s"'>/=]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/g))
      if (/^on/i.test(attr[1])) found.push(`${name}[${attr[1].toLowerCase()}]`);
  }
  return found;
}

/** Names of an element's attributes, for the testkit DOM and for a browser DOM. */
function attributeNames(el) {
  const attrs = el.attributes;
  if (!attrs) return [];
  return typeof attrs.length === 'number' ? Array.from(attrs, (a) => a.name) : Object.keys(attrs);
}

/**
 * Active markup below `input` (a markup string or a DOM node, shadow roots included).
 * Unparsed innerHTML of the testkit DOM is scanned as markup. An empty list means clean.
 */
function activeMarkup(input) {
  if (input == null || typeof input !== 'object') return activeInMarkup(input ?? '');
  const found = [];
  const walk = (node) => {
    if (node.nodeType === 1) {
      const name = String(node.localName || node.tagName || '').toLowerCase();
      if (ACTIVE_TAGS.has(name)) found.push(name);
      for (const attr of attributeNames(node)) if (/^on/i.test(attr)) found.push(`${name}[${attr.toLowerCase()}]`);
    }
    for (const child of node.childNodes || []) walk(child);
    if (typeof node._innerHTML === 'string' && node._innerHTML) found.push(...activeInMarkup(node._innerHTML));
    if (node.shadowRoot) walk(node.shadowRoot);
    if (node.content && node.content !== node) walk(node.content);
  };
  walk(input);
  return found;
}

module.exports = { TESTKIT_VERSION, createClock, flush, createDom, createEnvironment, loadScript, createHass, matchesSelector, XSS_PAYLOADS, activeMarkup };
