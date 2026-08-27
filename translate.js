/* =========================================================
 * Tourist Chinese — offline translator (dictionary lookup)
 * ---------------------------------------------------------
 * Searches the 20,000-word dictionary (data/dict.json):
 *   English -> 汉字 + pīnyīn,  汉字 -> English,  pīnyīn -> 汉字
 * Also wires up the bottom navigation (Learn / Translate).
 * ========================================================= */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const input = $("trInput");
  const resultsEl = $("trResults");
  const statusEl = $("trStatus");
  const clearBtn = $("trClear");
  const nav = $("bottomNav");
  const trScreen = $("translate");
  const homeScreen = $("home");
  const studyScreen = $("study");

  const CJK = /[\u3400-\u9fff]/;
  const LIMIT = 40;
  let index = null; // [{ en, hz, py, enL, pyN }]

  const strip = (s) =>
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function speak(hz) {
    if (!("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(hz);
    utter.lang = "zh-CN";
    utter.rate = 0.85;
    speechSynthesis.speak(utter);
  }

  // ---------- dictionary loading (lazy, once) ----------
  async function ensureDict() {
    if (index) return;
    statusEl.textContent = "Loading dictionary\u2026";
    try {
      const res = await fetch("data/dict.json");
      const data = await res.json();
      index = data.words.map(([en, hz, py]) => ({
        en, hz, py,
        enL: en.toLowerCase(),
        pyN: strip(py).replace(/[^a-z]/g, "")
      }));
    } catch (e) {
      statusEl.textContent =
        "Could not load the dictionary \u2014 go online once, then retry.";
      return;
    }
    runSearch();
  }

  // ---------- search ----------
  const isEdge = (ch) => !ch || !/[a-z]/.test(ch);

  function search(qRaw) {
    const q = qRaw.trim().toLowerCase();
    if (!q) return null;

    // Chinese input: match inside the hanzi itself
    if (CJK.test(q)) {
      return index.filter((w) => w.hz.includes(q)).slice(0, LIMIT);
    }

    const qN = strip(q).replace(/[^a-z]/g, "");
    const exact = [], start = [], inner = [], pyStart = [], pyIn = [];
    for (const w of index) {
      const e = w.enL;
      const i = e.indexOf(q);
      if (i === 0) {
        (e === q || isEdge(e[q.length]) ? exact : start).push(w);
      } else if (i > 0 && isEdge(e[i - 1]) && isEdge(e[i + q.length])) {
        inner.push(w);
      }
      if (qN) {
        if (w.pyN === qN || w.pyN.startsWith(qN)) pyStart.push(w);
        else if (w.pyN.includes(qN)) pyIn.push(w);
      }
    }

    const seen = new Set();
    const out = [];
    for (const w of [...exact, ...start, ...pyStart, ...inner, ...pyIn]) {
      const key = w.hz + "|" + w.en;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(w);
      if (out.length >= LIMIT) break;
    }
    return out;
  }

  // ---------- render ----------
  function render(list, q) {
    if (list === null) { resultsEl.innerHTML = ""; statusEl.textContent = ""; return; }
    if (!list.length) {
      statusEl.textContent = "No matches for \u201C" + q.trim() + "\u201D \u2014 try another word.";
      resultsEl.innerHTML = "";
      return;
    }
    statusEl.textContent = list.length + (list.length >= LIMIT ? "+" : "") +
      " match" + (list.length === 1 ? "" : "es");
    resultsEl.innerHTML = list.map((w) =>
      '<button class="tr-row" type="button">' +
      '<span class="tr-hz">' + esc(w.hz) + "</span>" +
      '<span class="tr-mid">' +
      '<span class="tr-py">' + esc(w.py) + "</span>" +
      '<span class="tr-en">' + esc(w.en) + "</span>" +
      "</span>" +
      '<span class="tr-speak" aria-hidden="true">\ud83d\udd0a</span>' +
      "</button>"
    ).join("");
  }

  let timer = null;
  function runSearch() {
    if (!index) return;
    const q = input.value;
    render(search(q), q);
    clearBtn.classList.toggle("hidden", !q);
  }

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(runSearch, 120);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); runSearch(); }
  });
  clearBtn.addEventListener("click", () => {
    input.value = "";
    runSearch();
    input.focus();
  });
  resultsEl.addEventListener("click", (e) => {
    const row = e.target.closest(".tr-row");
    if (row) speak(row.querySelector(".tr-hz").textContent);
  });

  // ---------- bottom navigation ----------
  function show(which) {
    homeScreen.classList.toggle("hidden", which !== "home");
    trScreen.classList.toggle("hidden", which !== "translate");
    if (which !== "study") studyScreen.classList.add("hidden");
    nav.querySelectorAll(".nav-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.nav === which));
    if (which === "translate") {
      ensureDict();
      window.scrollTo(0, 0);
    }
  }

  nav.addEventListener("click", (e) => {
    const b = e.target.closest(".nav-btn");
    if (b) show(b.dataset.nav);
  });

  // Hide the nav while studying — the study screen has its own back button.
  new MutationObserver(() => {
    nav.classList.toggle("hidden", !studyScreen.classList.contains("hidden"));
  }).observe(studyScreen, { attributes: true, attributeFilter: ["class"] });
})();
