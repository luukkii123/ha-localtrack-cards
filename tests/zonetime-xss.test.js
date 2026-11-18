"use strict";

// #1264 M1 (Buschcheck S1/D6): the person and place menus of the zone-time
// card show friendly_name as plain text. A tracker name is chosen by a device
// or an integration, so it must never become markup.
const test = require("node:test");
const assert = require("node:assert/strict");
const { zonenKarte, zustaende, ruhe, quelle } = require("./laden.js");

const PAYLOAD = "<img src=x onerror=alert(1)>&amp;";

function stats(tracked) {
  return (msg) => (msg.type === "localtrack/stats"
    ? Promise.resolve({ tracked })
    : new Promise(() => {}));
}

test("payload friendly_name in the person menu: no img, text stays raw", async () => {
  const { card } = zonenKarte({ states: zustaende({ a: PAYLOAD }), callWS: stats(["person.a", "person.b"]) });
  await ruhe();
  const menu = card._entityEl;
  assert.equal(menu.querySelectorAll("img").length, 0, "img element created");
  const options = menu.children;
  assert.deepEqual(options.map((o) => o.tagName), ["OPTION", "OPTION"]);
  assert.equal(options[0].textContent, PAYLOAD);
  assert.equal(options[0].value, "person.a");
  assert.equal(options[1].textContent, "Person B");
});

test("payload friendly_name in the place menu: no img, text stays raw", async () => {
  const { card } = zonenKarte({ states: zustaende({ work: PAYLOAD }), callWS: stats([]) });
  await ruhe();
  const menu = card._zoneEl;
  assert.equal(menu.querySelectorAll("img").length, 0, "img element created");
  const texts = menu.children.map((o) => o.textContent);
  assert.ok(texts.includes(PAYLOAD), `place names: ${JSON.stringify(texts)}`);
});

test("'A & <B>' is shown exactly as written", async () => {
  const { card } = zonenKarte({ states: zustaende({ a: "A & <B>", home: "A & <B>" }), callWS: stats(["person.a"]) });
  await ruhe();
  assert.equal(card._entityEl.children.length, 1);
  assert.equal(card._entityEl.children[0].textContent, "A & <B>");
  assert.ok(card._zoneEl.children.map((o) => o.textContent).includes("A & <B>"));
  assert.equal(card._zoneEl.querySelectorAll("b").length, 0, "<B> became an element");
});

test("an entity id with a quote stays the option value, not an attribute break", async () => {
  const states = zustaende();
  states['person.x"y'] = { attributes: { friendly_name: "X" } };
  const { card } = zonenKarte({ states, callWS: stats(['person.x"y']), config: { entity: 'person.x"y' } });
  await ruhe();
  const [option] = card._entityEl.children;
  assert.equal(option.value, 'person.x"y');
  assert.equal(option.textContent, "X");
  assert.equal(card._entityEl.value, 'person.x"y');
});

test("the menus are not rebuilt when ids and selection did not change", async () => {
  const { card, hass } = zonenKarte({ callWS: stats(["person.a", "person.b"]) });
  await ruhe();
  const before = card._entityEl.children[0];
  card.hass = { ...hass };
  assert.equal(card._entityEl.children[0], before, "options were rebuilt");
});

test("no string sink builds the menus", () => {
  assert.doesNotMatch(quelle(), /innerHTML = items/);
});
