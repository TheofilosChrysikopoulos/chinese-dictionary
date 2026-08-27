/* =========================================================
 * Tourist Chinese — flashcard app
 * Modes: SEQUENTIAL (in order) and RANDOM (shuffled).
 * The whole dictionary can also be practiced in RANDOM mode.
 * ========================================================= */

(function () {
  "use strict";

  // ---------- State ----------
  const state = {
    words: [],      // array of [english, hanzi, pinyin]
    index: 0,
    flipped: false,
    mode: "sequential",
    title: ""
  };

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const homeScreen = $("home");
  const studyScreen = $("study");
  const grid = $("categoryGrid");
  const wholeCard = $("wholeDictCard");
  const flashcard = $("flashcard");
  const cardEnglish = $("cardEnglish");
  const cardHanzi = $("cardHanzi");
  const cardPinyin = $("cardPinyin");
  const counterEl = $("counter");
  const progressFill = $("progressFill");
  const studyTitle = $("studyTitle");
  const studyMode = $("studyMode");
  const doneMsg = $("doneMsg");

  // ---------- Helpers ----------
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

  // ---------- Home screen ----------
  function buildHome() {
    grid.innerHTML = "";
    CATEGORIES.forEach((cat) => {
      const card = document.createElement("div");
      card.className = "cat-card";
      card.innerHTML = `
        <div class="cat-head">
          <span class="cat-icon">${cat.icon}</span>
          <span class="cat-name">${cat.name}</span>
        </div>
        <div class="cat-count">${cat.words.length} words</div>
        <div class="mode-btns">
          <button class="btn btn-seq" data-mode="sequential">1 → 2 → 3 (Sequential)</button>
          <button class="btn btn-rand" data-mode="random">🎲 Random</button>
        </div>`;
      card.querySelectorAll("button").forEach((btn) =>
        btn.addEventListener("click", () =>
          startStudy(cat.words, btn.dataset.mode, cat.name)
        )
      );
      grid.appendChild(card);
    });

    const total = CATEGORIES.reduce((n, c) => n + c.words.length, 0);
    const allWords = CATEGORIES.flatMap((c) => c.words);
    wholeCard.innerHTML = `
      <div class="whole-card">
        <div>
          <div class="cat-name">🌏 Whole Dictionary</div>
          <div class="cat-count">Random words from all ${total} words</div>
        </div>
        <div class="mode-btns">
          <button class="btn" id="wholeRandBtn">🎲 Random (1000 words)</button>
        </div>
      </div>`;
    $("wholeRandBtn").addEventListener("click", () =>
      startStudy(allWords, "random", "Whole Dictionary")
    );
  }

  // ---------- Study screen ----------
  function startStudy(words, mode, title) {
    state.words = mode === "random" ? shuffle(words) : words.slice();
    state.index = 0;
    state.flipped = false;
    state.mode = mode;
    state.title = title;

    studyTitle.textContent = title;
    studyMode.textContent = mode === "random" ? "🎲 Random" : "Sequential";

    homeScreen.classList.add("hidden");
    studyScreen.classList.remove("hidden");
    doneMsg.classList.add("hidden");
    flashcard.classList.remove("hidden");
    renderCard();
  }

  function renderCard() {
    const [en, hz, py] = state.words[state.index];
    cardEnglish.textContent = en;
    cardHanzi.textContent = hz;
    cardPinyin.textContent = py;
    state.flipped = false;
    flashcard.classList.remove("flipped");

    counterEl.textContent = `${state.index + 1} / ${state.words.length}`;
    progressFill.style.width = `${((state.index + 1) / state.words.length) * 100}%`;
  }

  function next() {
    if (state.index >= state.words.length - 1) {
      finish();
      return;
    }
    state.index++;
    renderCard();
  }

  function prev() {
    if (state.index > 0) {
      state.index--;
      renderCard();
    }
  }

  function flip() {
    state.flipped = !state.flipped;
    flashcard.classList.toggle("flipped", state.flipped);
  }

  function finish() {
    flashcard.classList.add("hidden");
    doneMsg.classList.remove("hidden");
    progressFill.style.width = "100%";
    counterEl.textContent = `${state.words.length} / ${state.words.length}`;
  }

  function goHome() {
    studyScreen.classList.add("hidden");
    homeScreen.classList.remove("hidden");
  }

  // ---------- Events ----------
  flashcard.addEventListener("click", flip);
  $("flipBtn").addEventListener("click", flip);
  $("nextBtn").addEventListener("click", next);
  $("prevBtn").addEventListener("click", prev);
  $("backBtn").addEventListener("click", goHome);
  $("speakBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    speak(state.words[state.index][1]);
  });
  $("restartBtn").addEventListener("click", () =>
    startStudy(state.words, state.mode, state.title)
  );

  document.addEventListener("keydown", (e) => {
    if (studyScreen.classList.contains("hidden")) return;
    if (e.code === "Space" || e.key === "Enter") {
      e.preventDefault();
      flip();
    } else if (e.key === "ArrowRight") {
      next();
    } else if (e.key === "ArrowLeft") {
      prev();
    } else if (e.key === "Escape") {
      goHome();
    }
  });

  // ---------- Init ----------
  buildHome();
})();
