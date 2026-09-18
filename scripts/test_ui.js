#!/usr/bin/env node
/*
 * Browser-free interaction test for the static site.
 * It executes app.js in a small DOM stub so that the test also covers
 * filtering and rendering without requiring a browser or npm dependencies.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const ids = [
  "longread-intro",
  "longread-toc",
  "longread-content",
  "comparison-list",
  "compare-status",
  "candidate-grid",
  "candidate-filter",
  "candidate-filter-status",
  "topic-filter",
  "evidence-filter",
  "search",
  "stat-candidates",
  "stat-topics",
  "stat-raw-topics",
  "stat-evidence",
  "ledger-list",
  "ledger-count",
  "disclosure-toggle"
];

class FakeElement {
  constructor(id) {
    this.id = id;
    this.value = "";
    this.textContent = "";
    this.innerHTML = "";
    this.dataset = {};
    this.checked = false;
    this.listeners = new Map();
  }

  addEventListener(type, callback) {
    this.listeners.set(type, callback);
  }

  dispatch(type, event = {}) {
    const callback = this.listeners.get(type);
    assert.ok(callback, `listener exists for ${this.id}:${type}`);
    callback({ target: this, ...event });
  }

  insertAdjacentHTML(_where, html) {
    this.innerHTML += html;
  }

  setAttribute(name, value) {
    this[name] = value;
  }

  closest() {
    return this;
  }
}

const elements = new Map(ids.map((id) => [id, new FakeElement(id)]));
const allFilterButton = new FakeElement("all-filter-button");
const document = {
  baseURI: "http://example.test/",
  querySelector(selector) {
    if (selector.startsWith("#")) return elements.get(selector.slice(1)) || null;
    if (selector === '[data-filter-action="all"]') return allFilterButton;
    return null;
  },
  querySelectorAll() {
    return [];
  },
  addEventListener(type, callback) {
    if (type === "DOMContentLoaded") callback();
  }
};

async function fetchLocal(url) {
  const file = new URL(url).pathname.replace(/^\//, "");
  const body = fs.readFileSync(file, "utf8");
  return {
    ok: true,
    text: async () => body,
    json: async () => JSON.parse(body)
  };
}

const context = { document, console, URL, fetch: fetchLocal, setTimeout, clearTimeout };
vm.createContext(context);
vm.runInContext(fs.readFileSync("app.js", "utf8"), context, { filename: "app.js" });

function waitForRender() {
  return new Promise((resolve) => setTimeout(resolve, 350));
}

function candidateTarget(id, checked) {
  return {
    checked,
    dataset: { candidate: id },
    closest() {
      return this;
    }
  };
}

(async () => {
  await waitForRender();

  const filter = elements.get("candidate-filter");
  const status = elements.get("candidate-filter-status");
  const longread = elements.get("longread-content");
  const comparison = elements.get("comparison-list");
  const cards = elements.get("candidate-grid");
  const ledgerCount = elements.get("ledger-count");

  // Initial page state and longread.
  assert.match(filter.innerHTML, /Юрий Гладунов/);
  assert.match(filter.innerHTML, /Единая Россия/);
  assert.match(filter.innerHTML, /Глеб Дудоладов/);
  assert.match(filter.innerHTML, /Справедливая Россия/);
  assert.match(filter.innerHTML, /Артём Зверев/);
  assert.match(filter.innerHTML, /ЛДПР/);
  assert.match(filter.innerHTML, /Роман Луговской/);
  assert.match(filter.innerHTML, /КПРФ/);
  assert.equal(String(elements.get("stat-candidates").textContent), "4");
  assert.equal(String(elements.get("stat-topics").textContent), "8");
  assert.equal(String(elements.get("stat-raw-topics").textContent), "79");
  assert.equal(String(elements.get("stat-evidence").textContent), "96");
  assert.match(longread.innerHTML, /longread-candidate-gladunov/);
  assert.match(longread.innerHTML, /longread-candidate-dudoladov/);
  assert.match(longread.innerHTML, /Хронология кампании/);
  assert.match(comparison.innerHTML, /ISS08/);
  assert.match(cards.innerHTML, /Глеб Дудоладов/);
  assert.equal(ledgerCount.textContent, "(96 записей)");
  assert.match(status.textContent, /все 4 кандидата/);

  // Multi-select: leave only Gladunov and Zverev.
  filter.dispatch("change", { target: candidateTarget("dudoladov", false) });
  filter.dispatch("change", { target: candidateTarget("lugovskoy", false) });
  assert.equal(status.textContent, "Показаны 2 кандидата.");
  assert.match(longread.innerHTML, /longread-candidate-gladunov/);
  assert.match(longread.innerHTML, /longread-candidate-zverev/);
  assert.match(longread.innerHTML, /Общие сведения/);
  assert.doesNotMatch(longread.innerHTML, /longread-candidate-dudoladov/);
  assert.doesNotMatch(longread.innerHTML, /longread-candidate-lugovskoy/);
  assert.match(cards.innerHTML, /Юрий Гладунов/);
  assert.doesNotMatch(cards.innerHTML, /Глеб Дудоладов/);
  assert.doesNotMatch(cards.innerHTML, /Роман Луговской/);
  assert.match(comparison.innerHTML, /Юрий Гладунов/);
  assert.doesNotMatch(comparison.innerHTML, /Глеб Дудоладов/);
  assert.equal(ledgerCount.textContent, "(63 записей)");

  // The last selected candidate cannot be unchecked into an empty page.
  filter.dispatch("change", { target: candidateTarget("gladunov", false) });
  assert.equal(status.textContent, "Показан 1 кандидат.");
  const last = candidateTarget("zverev", false);
  filter.dispatch("change", { target: last });
  assert.equal(last.checked, true);
  assert.equal(status.textContent, "Показан 1 кандидат.");
  assert.match(longread.innerHTML, /longread-candidate-zverev/);

  // Restore all candidates with the top control.
  allFilterButton.dispatch("click");
  assert.match(status.textContent, /все 4 кандидата/);
  assert.match(longread.innerHTML, /longread-candidate-lugovskoy/);
  assert.equal(ledgerCount.textContent, "(96 записей)");

  // Topic filter shows only one comparison question.
  const topic = elements.get("topic-filter");
  topic.value = "ISS08";
  topic.dispatch("change");
  assert.match(comparison.innerHTML, /ISS08/);
  assert.doesNotMatch(comparison.innerHTML, /ISS01/);

  // Evidence filter and search both affect the comparison results.
  const evidence = elements.get("evidence-filter");
  evidence.value = "party";
  evidence.dispatch("change");
  assert.match(elements.get("compare-status").textContent, /Тем:/);
  const search = elements.get("search");
  search.value = "строка-которой-нет";
  search.dispatch("input");
  assert.match(comparison.innerHTML, /Ничего не найдено/);
  search.value = "";
  search.dispatch("input");

  // Disclosure control changes its label in both directions.
  const disclosure = elements.get("disclosure-toggle");
  assert.equal(disclosure.textContent, "Показать все темы");
  disclosure.dispatch("click");
  assert.equal(disclosure.textContent, "Свернуть все темы");
  disclosure.dispatch("click");
  assert.equal(disclosure.textContent, "Показать все темы");

  console.log("UI interaction tests: OK");
})().catch((error) => {
  console.error("UI interaction tests: FAIL");
  console.error(error);
  process.exitCode = 1;
});
