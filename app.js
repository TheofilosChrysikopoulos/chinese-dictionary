/* =========================================================
 * Tourist Chinese — flashcard app
 * ---------------------------------------------------------
 * Modes:    SEQUENTIAL (in order) and RANDOM (shuffled),
 *           per category or the whole dictionary (random).
 * Sides:    "English first" (EN -> hanzi -> pinyin) or
 *           "Chinese first" (hanzi -> pinyin -> EN).
 *           Pinyin is blurred until tapped so the hanzi
 *           can be recalled without the romanisation.
 * ========================================================= */

(function () {
  "use strict";

  // ---------- Constants ----------
  const ACCENTS = [
    "#d92b3a", "#e8762d", "#dda605", "#6ea62f", "#1f7a4d",
    "#0f8f8f", "#3b82c4", "#5b6bd6", "#8b5cd6", "#c94f8e"
  ];
  const DIR_KEY = "tc-direction";

  // stage 0 -> 1 -> 2, tap cycles forward (see applyStage)
  const HINTS = {
    en: ["tap to see \u6c49\u5b57", "tap to reveal p\u012bny\u012bn", "tap to start over"],
    zh: ["tap to reveal p\u012bny\u012bn", "tap to see English", "tap to start over"]
  };

  // ---------- State ----------
  const state = {
    source: [],     // words in original (unshuffled) order
    words: [],      // working order (may be shuffled)
    index: 0,
    stage: 0,       // 0/1/2 — which reveal step of the card is shown
    mode: "sequential",
    title: "",
    direction: "en" // "en" = English side first, "zh" = hanzi side first
  };

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const homeScreen = $("home");
  const studyScreen = $("study");
  const grid = $("categoryGrid");
  const wholeCard = $("wholeDictCard");
  const flashcard = $("flashcard");
  const faceFront = $("faceFront");
  const faceBack = $("faceBack");
  const counterEl = $("counter");
  const progressFill = $("progressFill");
  const studyTitle = $("studyTitle");
  const studyMode = $("studyMode");
  const dirBtn = $("dirBtn");
  const cardStage = $("cardStage");
  const controls = $("controls");
  const doneMsg = $("doneMsg");

  // ---------- Helpers ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function speak(hanzi) {
    if (!("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(hanzi);
    utter.lang = "zh-CN";
    utter.rate = 0.85;
    speechSynthesis.speak(utter);
  }

  function loadDirection() {
    try {
      const saved = localStorage.getItem(DIR_KEY);
      if (saved === "en" || saved === "zh") return saved;
    } catch (e) { /* storage unavailable — ignore */ }
    return "en";
  }

  function saveDirection() {
    try { localStorage.setItem(DIR_KEY, state.direction); } catch (e) {}
  }

  // ---------- Card faces ----------
  function englishFace(en) {
    return (
      '<span class="face-tag">English</span>' +
      '<div class="face-word">' + esc(en) + '</div>' +
      '<span class="face-hint"></span>'
    );
  }

  function chineseFace(hz, py) {
    return (
      '<span class="face-tag">\u6c49\u5b57</span>' +
      '<div class="face-hanzi">' + esc(hz) + '</div>' +
      '<div class="face-pinyin">' + esc(py) + '</div>' +
      '<button class="speak-btn" type="button" title="Hear pronunciation" aria-label="Hear pronunciation">\ud83d\udd0a</button>' +
      '<span class="face-hint"></span>'
    );
  }

  // ---------- Home screen ----------
  function buildHome() {
    grid.innerHTML = "";
    CATEGORIES.forEach((cat, i) => {
      const accent = ACCENTS[i % ACCENTS.length];
      const card = document.createElement("div");
      card.className = "cat-card";
      card.style.setProperty("--accent", accent);
      card.style.setProperty("--accent-soft", accent + "18");
      card.innerHTML =
        '<div class="cat-head">' +
        '<span class="cat-icon">' + cat.icon + '</span>' +
        '<span class="cat-name">' + esc(cat.name) + '</span>' +
        '</div>' +
        '<div class="cat-count">' + cat.words.length + ' words</div>' +
        '<div class="mode-btns">' +
        '<button class="btn btn-seq">1 \u2192 2 \u2192 3</button>' +
        '<button class="btn btn-rand">\ud83c\udfb2 Random</button>' +
        '</div>';
      card.querySelectorAll("button").forEach((btn, k) =>
        btn.addEventListener("click", () =>
          startStudy(cat.words, k === 0 ? "sequential" : "random", cat.name)
        )
      );
      grid.appendChild(card);
    });

    const total = CATEGORIES.reduce((n, c) => n + c.words.length, 0);
    wholeCard.innerHTML =
      '<div class="whole-card">' +
      '<div class="whole-info">' +
      '<div class="cat-name">\ud83c\udf0f Whole Dictionary</div>' +
      '<div class="cat-count">Random words from all ' + total + ' words</div>' +
      '</div>' +
      '<button class="btn-whole" id="wholeRandBtn">\ud83c\udfb2 Random &nbsp;\u00b7&nbsp; ' + total + ' words</button>' +
      '</div>';
    $("wholeRandBtn").addEventListener("click", () => {
      const all = CATEGORIES.flatMap((c) => c.words);
      startStudy(all, "random", "Whole Dictionary");
    });
  }

  // ---------- Study screen ----------
  function startStudy(words, mode, title) {
    state.source = words.slice();
    state.words = mode === "random" ? shuffle(words) : words.slice();
    state.index = 0;
    state.mode = mode;
    state.title = title;

    studyTitle.textContent = title;
    studyMode.textContent = mode === "random" ? "\ud83c\udfb2 Random" : "Sequential";
    updateDirBtn();

    homeScreen.classList.add("hidden");
    studyScreen.classList.remove("hidden");
    doneMsg.classList.add("hidden");
    cardStage.classList.remove("hidden");
    controls.classList.remove("hidden");
    renderCard();
  }

  function renderCard() {
    const [en, hz, py] = state.words[state.index];
    if (state.direction === "en") {
      faceFront.innerHTML = englishFace(en);
      faceBack.innerHTML = chineseFace(hz, py);
    } else {
      faceFront.innerHTML = chineseFace(hz, py);
      faceBack.innerHTML = englishFace(en);
    }
    setStage(0);

    counterEl.textContent = (state.index + 1) + " / " + state.words.length;
    progressFill.style.width =
      ((state.index + 1) / state.words.length) * 100 + "%";
  }

  function setStage(s) {
    state.stage = s;
    applyStage();
  }

  // Maps the 0/1/2 reveal stage onto the card's flip + pinyin state.
  function applyStage() {
    const s = state.stage;
    const enFirst = state.direction === "en";
    flashcard.classList.toggle("flipped", enFirst ? s >= 1 : s >= 2);
    setPinyin(enFirst ? s >= 2 : s >= 1);
    updateHint();
  }

  function setPinyin(show) {
    flashcard.querySelectorAll(".face-pinyin").forEach((el) =>
      el.classList.toggle("revealed", show)
    );
  }

  function updateHint() {
    const face = flashcard.classList.contains("flipped") ? faceBack : faceFront;
    const hint = face.querySelector(".face-hint");
    if (hint) hint.textContent = HINTS[state.direction][state.stage];
  }

  function advance() {
    setStage(state.stage >= 2 ? 0 : state.stage + 1);
  }

  function flipCard() {
    // Jump straight to the *other* side (pinyin still hidden when arriving
    // on the hanzi side).
    if (state.direction === "en") {
      setStage(state.stage === 0 ? 1 : 0);
    } else {
      setStage(state.stage < 2 ? 2 : 0);
    }
  }

  function next() {
    if (state.index >= state.words.length - 1) { finish(); return; }
    state.index++;
    renderCard();
  }

  function prev() {
    if (state.index > 0) { state.index--; renderCard(); }
  }

  function finish() {
    cardStage.classList.add("hidden");
    controls.classList.add("hidden");
    doneMsg.classList.remove("hidden");
    progressFill.style.width = "100%";
    counterEl.textContent = state.words.length + " / " + state.words.length;
    $("doneCount").textContent = state.words.length;
  }

  function goHome() {
    studyScreen.classList.add("hidden");
    homeScreen.classList.remove("hidden");
  }

  function updateDirBtn() {
    dirBtn.textContent =
      state.direction === "en" ? "\ud83c\uddec\ud83c\udde7 English first" : "\ud83c\udde8\ud83c\uddf3 Chinese first";
  }

  function toggleDirection() {
    state.direction = state.direction === "en" ? "zh" : "en";
    saveDirection();
    updateDirBtn();
    renderCard(); // reset the current card for the new side order
  }

  // ---------- Events ----------
  flashcard.addEventListener("click", (e) => {
    if (e.target.closest(".speak-btn")) {
      speak(state.words[state.index][1]);
      return;
    }
    advance();
  });

  dirBtn.addEventListener("click", toggleDirection);
  $("flipBtn").addEventListener("click", flipCard);
  $("nextBtn").addEventListener("click", next);
  $("prevBtn").addEventListener("click", prev);
  $("backBtn").addEventListener("click", goHome);
  $("doneHomeBtn").addEventListener("click", goHome);
  $("restartBtn").addEventListener("click", () => {
    // Re-shuffle for random mode so a repeat run feels fresh.
    startStudy(state.source, state.mode, state.title);
  });

  document.addEventListener("keydown", (e) => {
    if (studyScreen.classList.contains("hidden")) return;
    if (e.code === "Space" || e.key === "Enter") {
      e.preventDefault();
      advance();
    } else if (e.key === "ArrowRight") {
      next();
    } else if (e.key === "ArrowLeft") {
      prev();
    } else if (e.key === "Escape") {
      goHome();
    }
  });

  // ---------- Init ----------
  state.direction = loadDirection();
  buildHome();
})();
