/* =========================================================
 * Tourist Chinese — offline translator (dictionary lookup)
 * ---------------------------------------------------------
 * UX model: ONE primary answer card + up to two suggestion
 * cards, shown only when the query is genuinely ambiguous
 * (relevance score >= 60). Weaker matches stay collapsed
 * behind a "show all N matches" expander.
 *
 * Relevance scoring (English queries):
 *   100  query equals the FIRST meaning        e.g. "heart" -> 心
 *    80  query is a clean prefix of first meaning
 *    65  query is a prefix-in-word of 1st      "alcohol" -> "alcoholic..."
 *    60  query equals a LATER meaning, or appears as a
 *        whole word inside the first meaning
 *    45/50/40  same patterns on later meanings
 *    20  plain substring (weak)
 * Frequency (dictionary rank) breaks ties.
 * Pinyin and hanzi queries score 15–100 analogously.
 * Everything runs fully offline against data/dict.json.
 * ========================================================= */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const input = $("trInput");
  const resultsEl = $("trResults");
  const statusEl = $("trStatus");
  const clearBtn = $("trClear");
  const seg = $("segControl");
  const brandBtn = $("brandBtn");
  const trCta = $("trCta");
  const trScreen = $("translate");
  const homeScreen = $("home");
  const studyScreen = $("study");
  const voiceScreen = $("voice");

  const CJK = /[\u3400-\u9fff]/;
  const SUGGEST_MIN = 60; // score needed to earn a suggestion card
  const MAX_CARDS = 3;    // primary + up to 2 suggestions
  const DEBOUNCE_MS = 120;

  // Everyday words whose dictionary gloss doesn't contain the obvious
  // English query (e.g. 酒 is glossed "wine; liquor", never "alcohol").
  // These get the same score as a perfect exact-meaning match, so the
  // frequency tie-break decides — the common everyday word wins.
  const SYNONYMS = { "alcohol": "酒" };

  let index = null;       // [{ hz, py, senses, senseL, pyN, pos }]
  let expanded = false;   // "show all matches" toggle
  let lastList = [];      // ranked candidates from the last search
  let lastQ = "";

  /* ---------- helpers ---------- */

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  // strip tone marks -> plain letters, for fuzzy pinyin ("ni hao" ~ "nǐ hǎo")
  function strip(s) {
    return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function speak(hz) {
    try {
      const u = new SpeechSynthesisUtterance(hz);
      u.lang = "zh-CN";
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch (e) { /* speech unavailable */ }
  }

  /* ---------- dictionary loading ---------- */

  async function ensureDict() {
    if (index) return;
    statusEl.textContent = "Loading dictionary…";
    try {
      const res = await fetch("data/dict.json");
      const data = await res.json();
      const rows = data.words || data;
      index = rows.map((r, pos) => {
        const senses = String(r[0]).split(/;\s*/).filter(Boolean);
        return {
          hz: r[1],
          py: r[2],
          senses: senses,
          senseL: senses.map((s) => strip(s).toLowerCase()),
          pyN: strip(r[2]).toLowerCase().replace(/[^a-z]/g, ""),
          pos: pos
        };
      });
    } catch (e) {
      statusEl.textContent = "Could not load the dictionary.";
      return;
    }
    statusEl.textContent = "";
    if (input.value.trim()) runSearch();
  }

  /* ---------- relevance scoring ---------- */

  // a letter is an "edge" if it's not [a-z] (start/end of string, space, etc.)
  const isEdge = (c) => !c || !/[a-z]/.test(c);

  function scoreEnglish(w, q) {
    let s = 0;
    for (let i = 0; i < w.senseL.length; i++) {
      const e = w.senseL[i];
      if (e === q) {
        s = Math.max(s, i === 0 ? 100 : 60);          // exact meaning
      } else if (e.startsWith(q)) {
        s = Math.max(s, isEdge(e[q.length])
          ? (i === 0 ? 80 : 50)                        // clean prefix
          : (i === 0 ? 65 : 40));                      // "alcohol" -> "alcoholic"
      } else {
        const j = e.indexOf(q);
        if (j >= 0) {
          s = Math.max(s, (isEdge(e[j - 1]) && isEdge(e[j + q.length]))
            ? (i === 0 ? 60 : 45)                      // whole word inside
            : 20);                                     // plain substring
        }
      }
    }
    return s;
  }

  // rank every entry against the query; returns [{ w, s }] sorted best-first.
  // Ties: shorter hanzi wins (the simpler, more general word), then rank.
  function rank(qRaw) {
    const q = qRaw.trim().toLowerCase();
    if (!q) return [];
    const qN = strip(q).replace(/[^a-z]/g, "");
    const syn = !CJK.test(q) ? SYNONYMS[q] : null;
    const out = [];
    index.forEach((w) => {
      let s = 0;
      if (CJK.test(q)) {                 // hanzi query
        if (w.hz === q) s = 100;
        else if (w.hz.startsWith(q)) s = 65;
        else if (w.hz.includes(q)) s = 50;
      } else {                           // english / pinyin query
        s = scoreEnglish(w, q);
        if (syn === w.hz) s = Math.max(s, 100);
        if (qN) {
          if (w.pyN === qN) s = Math.max(s, 70);
          else if (w.pyN.startsWith(qN)) s = Math.max(s, 40);
          else if (w.pyN.includes(qN)) s = Math.max(s, 15);
        }
      }
      if (s) out.push({ w: w, s: s });
    });
    out.sort((a, b) =>
      b.s - a.s || a.w.hz.length - b.w.hz.length || a.w.pos - b.w.pos);
    return out;
  }

  /* ---------- rendering ---------- */

  function primaryCard(c) {
    const w = c.w;
    return (
      '<div class="ans-card" role="button" tabindex="0" ' +
      'aria-label="' + esc(w.hz) + ", " + esc(w.py) + ', tap to hear">' +
      '<span class="ans-tag">Best match</span>' +
      '<span class="ans-speak" aria-hidden="true">\ud83d\udd0a</span>' +
      '<div class="ans-hz">' + esc(w.hz) + "</div>" +
      '<div class="ans-py">' + esc(w.py) + "</div>" +
      '<div class="ans-en">' + esc(w.senses.join("; ")) + "</div>" +
      "</div>"
    );
  }

  function altRow(c) {
    const w = c.w;
    return (
      '<button class="alt-row" type="button">' +
      '<span class="alt-hz">' + esc(w.hz) + "</span>" +
      '<span class="alt-mid">' +
      '<span class="alt-py">' + esc(w.py) + "</span>" +
      '<span class="alt-en">' + esc(w.senses.join("; ")) + "</span>" +
      "</span>" +
      '<span class="alt-speak" aria-hidden="true">\ud83d\udd0a</span>' +
      "</button>"
    );
  }

  function render() {
    if (!lastQ) { resultsEl.innerHTML = ""; return; }
    if (!lastList.length) {
      resultsEl.innerHTML =
        '<div class="tr-empty"><span class="big">\ud83d\udd0e</span>' +
        "No match for \u201C" + esc(lastQ) + "\u201D.<br>" +
        "Try another word, or type it in p\u012bny\u012bn.</div>";
      return;
    }

    const primary = lastList[0];
    const suggestions = [];
    const shown = new Set([primary.w.hz]);
    for (let i = 1; i < lastList.length && suggestions.length < MAX_CARDS - 1; i++) {
      const c = lastList[i];
      if (c.s >= SUGGEST_MIN && !shown.has(c.w.hz)) {
        suggestions.push(c);
        shown.add(c.w.hz);
      }
    }

    let html = primaryCard(primary);
    if (suggestions.length) {
      html += '<div class="alt-head">Other words for \u201C' + esc(lastQ) + "\u201D</div>" +
        '<div class="alt-list">' + suggestions.map(altRow).join("") + "</div>";
    }

    const rest = lastList.slice(1).filter((c) => !shown.has(c.w.hz));
    if (expanded && rest.length) {
      html += '<div class="alt-head">All matches</div>' +
        '<div class="alt-list">' + rest.map(altRow).join("") + "</div>";
    }
    if (rest.length) {
      html += '<button class="more-btn" type="button">' +
        (expanded ? "\u2191 Show fewer" :
          "Show all " + rest.length + " more match" + (rest.length === 1 ? "" : "es") + " \u2193") +
        "</button>";
    }
    resultsEl.innerHTML = html;
  }

  function runSearch() {
    if (!index) return;
    lastQ = input.value.trim();
    lastList = rank(lastQ);
    expanded = false;
    render();
    clearBtn.classList.toggle("hidden", !lastQ);
  }

  /* ---------- events ---------- */

  let t = null;
  input.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(runSearch, DEBOUNCE_MS);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { clearTimeout(t); runSearch(); }
  });
  clearBtn.addEventListener("click", () => {
    input.value = "";
    runSearch();
    input.focus();
  });

  resultsEl.addEventListener("click", (e) => {
    const more = e.target.closest(".more-btn");
    if (more) { expanded = !expanded; render(); return; }
    const card = e.target.closest(".ans-card, .alt-row");
    if (card) {
      const hz = card.querySelector(".ans-hz, .alt-hz");
      if (hz) speak(hz.textContent);
    }
  });
  resultsEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest(".ans-card");
    if (card) {
      e.preventDefault();
      const hz = card.querySelector(".ans-hz");
      if (hz) speak(hz.textContent);
    }
  });

  /* ---------- top navigation (segmented control) ---------- */

  function show(which) {
    homeScreen.classList.toggle("hidden", which !== "home");
    trScreen.classList.toggle("hidden", which !== "translate");
    voiceScreen.classList.toggle("hidden", which !== "voice");
    if (which !== "study") studyScreen.classList.add("hidden");
    seg.querySelectorAll(".seg-btn").forEach((b) => {
      const active = b.dataset.nav === which;
      b.classList.toggle("active", active);
      b.setAttribute("aria-selected", active ? "true" : "false");
    });
    if (which === "translate") {
      ensureDict();
      window.scrollTo(0, 0);
      // only auto-focus (and pop the mobile keyboard) on desktop
      if (window.matchMedia("(min-width: 900px)").matches) input.focus();
    }
    if (which === "voice") {
      window.scrollTo(0, 0);
      if (window.TCVoice) window.TCVoice.onShow();
    }
  }

  seg.addEventListener("click", (e) => {
    const b = e.target.closest(".seg-btn");
    if (b) show(b.dataset.nav);
  });
  brandBtn.addEventListener("click", () => show("home"));
  trCta.addEventListener("click", () => show("translate"));
})();
