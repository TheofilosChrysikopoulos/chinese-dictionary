/* =========================================================
 * Tourist Chinese — AI voice translator (on-device)
 * ---------------------------------------------------------
 * Two small neural models, both downloaded on demand and
 * then cached in the browser's Cache API — after the first
 * download everything runs 100% offline:
 *
 *   1. Speech recognition  — OpenAI Whisper via
 *      transformers.js (ONNX runtime, WebGPU/WASM)
 *   2. Translation         — Qwen LLM via WebLLM (WebGPU)
 *
 * Pipeline:  mic -> Whisper -> transcript -> Qwen
 *            -> translation -> pinyin (pinyin-pro) -> speechSynthesis
 *
 * The Translate tab uses the same Qwen engine for full written
 * sentences (language auto-detected) — one download powers both.
 *
 * No build step: both libraries are ES modules loaded from
 * a CDN with dynamic import() on first use, and the service
 * worker runtime-caches those CDN files for offline use.
 * ========================================================= */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  /* ---------- model catalogue ---------- */

  // WebLLM prebuilt model IDs (see webllm's config.ts).
  const TRANSLATION_MODELS = [
    {
      id: "Qwen3-1.7B-q4f16_1-MLC",
      label: "Qwen3 · 1.7B — recommended",
      size: "~1.2 GB",
      note: "Best balance: fast and excellent Chinese."
    },
    {
      id: "Qwen3-0.6B-q4f16_1-MLC",
      label: "Qwen3 · 0.6B — smallest",
      size: "~600 MB",
      note: "Fastest and lightest; quality drops on long sentences."
    },
    {
      id: "Qwen3.5-0.8B-q4f16_1-MLC",
      label: "Qwen3.5 · 0.8B — newest small",
      size: "~700 MB",
      note: "New generation, very efficient."
    },
    {
      id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
      label: "Qwen2.5 · 1.5B — classic",
      size: "~1.1 GB",
      note: "The stable workhorse the DeepSeek distills are built on."
    },
    {
      id: "Qwen3.5-2B-q4f16_1-MLC",
      label: "Qwen3.5 · 2B — bigger sibling",
      size: "~1.4 GB",
      note: "A step up from the default when you want extra polish."
    },
    {
      id: "Qwen3-4B-q4f16_1-MLC",
      label: "Qwen3 · 4B — highest quality",
      size: "~2.7 GB",
      note: "Best translations; needs a strong phone, slower responses."
    }
  ];

  // transformers.js (ONNX) model repos on the Hugging Face Hub.
  const VOICE_MODELS = [
    {
      id: "onnx-community/whisper-base",
      label: "Whisper Base — recommended",
      size: "~85 MB",
      note: "Good accuracy for English and Mandarin."
    },
    {
      id: "onnx-community/whisper-tiny",
      label: "Whisper Tiny — fastest",
      size: "~45 MB",
      note: "Quickest, fine for short clear phrases."
    },
    {
      id: "onnx-community/whisper-small",
      label: "Whisper Small — most accurate",
      size: "~250 MB",
      note: "Best recognition, especially in noisy places."
    }
  ];

  const MODEL_KEY = "tc-ai-model";
  const VOICE_KEY = "tc-ai-voice";
  const MAX_RECORD_MS = 15000;

  /* ---------- state ---------- */

  const ai = {
    webllm: null,        // the webllm module once imported
    engine: null,        // CreateMLCEngine handle
    engineModel: null,   // model id currently loaded in the engine
    transformers: null,  // the transformers.js module once imported
    asr: null,           // whisper pipeline
    asrModel: null,      // model id currently loaded in the pipeline
    busy: false,         // loading / recording / translating
    enginePromise: null, // in-flight engine load (shared by both tabs)
    recording: null      // { dir, stop: () => Promise<Float32Array @16k>, cancelTimer }
  };

  /* ---------- DOM ---------- */

  const trSelect = $("vcTrModel");
  const asrSelect = $("vcAsrModel");
  const loadBtn = $("vcLoadBtn");
  const storageEl = $("vcStorage");
  const progWrap = $("vcProgWrap");
  const progFill = $("vcProgFill");
  const progText = $("vcProgText");
  const readyBadge = $("vcReady");
  const warnEl = $("vcWarn");
  const micEn = $("vcMicEn");
  const micZh = $("vcMicZh");
  const hintEl = $("vcHint");
  const statusEl = $("vcStatus");
  const resultEl = $("vcResult");
  const heardEl = $("vcHeard");
  const hanziEl = $("vcHanzi");
  const pinyinEl = $("vcPinyin");
  const englishEl = $("vcEnglish");
  const listenBtn = $("vcListenBtn");

  // Translate tab — AI sentence translation (same engine as the Voice tab).
  const trInput = $("trInput");
  const trAiSelect = $("trAiModel");
  const trAiBtn = $("trAiBtn");
  const trAiNoteEl = $("trAiNote");
  const trAiProgWrap = $("trAiProgWrap");
  const trAiProgFill = $("trAiProgFill");
  const trAiProgText = $("trAiProgText");
  const trAiStatusEl = $("trAiStatus");
  const trAiResult = $("trAiResult");
  const trAiHanzi = $("trAiHanzi");
  const trAiPinyin = $("trAiPinyin");
  const trAiEnglish = $("trAiEnglish");
  const trAiSpeak = $("trAiSpeak");

  /* ---------- helpers ---------- */

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function loadPref(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      if (v) return v;
    } catch (e) { /* storage unavailable */ }
    return fallback;
  }

  function savePref(key, val) {
    try { localStorage.setItem(key, val); } catch (e) {}
  }

  function setStatus(msg) {
    statusEl.textContent = msg || "";
  }

  function setProgress(pct, text) {
    progWrap.classList.remove("hidden");
    progFill.style.width = Math.max(2, Math.min(100, Math.round(pct))) + "%";
    progText.textContent = text || "";
  }

  function hideProgress() {
    progWrap.classList.add("hidden");
    progFill.style.width = "0%";
    progText.textContent = "";
  }

  function updateStorage() {
    if (!(navigator.storage && navigator.storage.estimate)) return;
    navigator.storage.estimate().then((est) => {
      const mb = (est.usage / 1048576).toFixed(0);
      const total = est.quota ? " of ~" + (est.quota / 1073741824).toFixed(1) + " GB" : "";
      storageEl.textContent = mb + " MB cached" + total;
    }).catch(function () {});
  }

  function speak(text, lang) {
    if (!("speechSynthesis" in window) || !text) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = lang.indexOf("zh") === 0 ? 0.85 : 0.95;
      const voices = speechSynthesis.getVoices();
      const v = voices.find((x) => x.lang.replace("_", "-").indexOf(lang) === 0);
      if (v) u.voice = v;
      speechSynthesis.speak(u);
    } catch (e) { /* speech unavailable */ }
  }

  /* ---------- model loading ---------- */

  // The engine-load UI is pluggable: the Voice tab shows progress in its
  // own widgets, the Translate tab in its own. WebLLM reports
  // { progress: 0..1, text } — "Fetching param cache[5/38]…".
  function voiceUi() {
    return { status: setStatus, progress: setProgress };
  }

  function loadEngineInto(wanted, ui) {
    ui.status("Loading " + wanted + " (one-time download)…");
    const opts = {
      initProgressCallback: (report) =>
        ui.progress((report.progress || 0) * 100, report.text || "Loading translation model…")
    };
    const p = ai.engine
      ? ai.engine.reload(wanted, opts)
      : ai.webllm.CreateMLCEngine(wanted, opts);
    return p.then((eng) => {
      ai.engine = eng;
      ai.engineModel = wanted;
      readyBadge.textContent = "ready · offline";
      updateMicButtons();
    });
  }

  function doEnsureEngine(wanted, ui) {
    if (!navigator.gpu) {
      return Promise.reject(new Error(
        "This browser has no WebGPU support, so the on-device translation model cannot run here."));
    }
    if (!ai.webllm) {
      ui.status("Fetching the WebLLM engine…");
      return import("https://esm.run/@mlc-ai/web-llm").then((mod) => {
        ai.webllm = mod;
        return loadEngineInto(wanted, ui);
      });
    }
    return loadEngineInto(wanted, ui);
  }

  // Loads (or reloads) the Qwen engine for `modelId`. Loads are chained so
  // the Voice tab and the Translate tab never race on the same engine.
  function ensureEngine(modelId, ui) {
    ui = ui || voiceUi();
    const wanted = modelId || trSelect.value;
    const prev = ai.enginePromise || Promise.resolve();
    const task = prev.catch(() => {}).then(() => {
      if (ai.engine && ai.engineModel === wanted) return;
      return doEnsureEngine(wanted, ui);
    });
    ai.enginePromise = task;
    return task;
  }

  async function ensureAsr() {
    const wanted = asrSelect.value;
    if (ai.asr && ai.asrModel === wanted) return;
    if (!ai.transformers) {
      setStatus("Fetching the speech engine…");
      ai.transformers = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3");
      ai.transformers.env.allowLocalModels = false;
    }
    setStatus("Loading " + wanted + " (one-time download)…");
    const make = (device) => ai.transformers.pipeline("automatic-speech-recognition", wanted, {
      dtype: "q8",
      device: device,
      progress_callback: (p) => {
        if (p && p.status === "progress" && p.total && p.file && p.file.indexOf("_quantized") !== -1) {
          setProgress((p.loaded / p.total) * 100, "Downloading " + wanted.split("/").pop() + "…");
        }
      }
    });
    try {
      ai.asr = await (navigator.gpu ? make("webgpu") : make("wasm"));
    } catch (e) {
      // some GPUs miss shader-f16 etc. — retry on CPU
      ai.asr = await make("wasm");
    }
    ai.asrModel = wanted;
  }

  async function loadModels() {
    if (ai.busy) return;
    ai.busy = true;
    loadBtn.disabled = true;
    readyBadge.textContent = "loading…";
    setStatus("");
    try {
      await ensureAsr();
      await ensureEngine();
      readyBadge.textContent = "ready · offline";
      setStatus("AI models ready — everything now works offline.");
      updateStorage();
      if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().catch(() => {});
      }
    } catch (e) {
      readyBadge.textContent = "not loaded";
      setStatus("Could not load the AI models: " + (e && e.message ? e.message : e));
    } finally {
      ai.busy = false;
      hideProgress();
      loadBtn.disabled = false;
      updateMicButtons();
    }
  }

  /* ---------- audio capture ---------- */

  // Linear-interpolation resampler — plenty for 16 kHz speech recognition.
  function resampleTo16k(input, fromRate) {
    if (fromRate === 16000) return input;
    const ratio = fromRate / 16000;
    const outLen = Math.max(1, Math.floor(input.length / ratio));
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const pos = i * ratio;
      const i0 = Math.floor(pos);
      const i1 = Math.min(i0 + 1, input.length - 1);
      const frac = pos - i0;
      out[i] = input[i0] * (1 - frac) + input[i1] * frac;
    }
    return out;
  }

  // Captures raw mono PCM straight from the microphone via Web Audio.
  // Unlike a MediaRecorder + decodeAudioData round-trip this works in
  // every Chromium browser (including VS Code's webview, which cannot
  // decode the webm/opus blobs MediaRecorder produces).
  function startRecording(dir) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(new Error("This browser does not support microphone access."));
    }
    if (!(window.AudioContext || window.webkitAudioContext)) {
      return Promise.reject(new Error("This browser does not support Web Audio recording."));
    }
    return navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const rate = ctx.sampleRate;
      const src = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      const chunks = [];
      proc.onaudioprocess = (e) => {
        chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };
      // ScriptProcessor only runs while connected to the destination —
      // route it through a mute node so the mic never plays out loud.
      const mute = ctx.createGain();
      mute.gain.value = 0;
      src.connect(proc);
      proc.connect(mute);
      mute.connect(ctx.destination);

      const stop = function () {
        return new Promise((resolve) => {
          proc.onaudioprocess = null;
          try {
            src.disconnect(proc);
            proc.disconnect(mute);
            mute.disconnect(ctx.destination);
          } catch (e) { /* already torn down */ }
          stream.getTracks().forEach((t) => t.stop());
          ctx.close();
          let total = 0;
          for (let i = 0; i < chunks.length; i++) total += chunks[i].length;
          const all = new Float32Array(total);
          let off = 0;
          for (let i = 0; i < chunks.length; i++) {
            all.set(chunks[i], off);
            off += chunks[i].length;
          }
          resolve(resampleTo16k(all, rate));
        });
      };

      const session = { dir: dir, stop: stop, cancelTimer: () => {} };
      // Safety net: stop and translate automatically after MAX_RECORD_MS.
      const timer = setTimeout(() => finishRecording(session), MAX_RECORD_MS);
      session.cancelTimer = () => clearTimeout(timer);

      return session;
    });
  }

  /* ---------- transcription + translation ---------- */

  async function transcribe(pcm16k, dir) {
    const lang = dir === "en2zh" ? "english" : "chinese";
    const out = await ai.asr(pcm16k, { language: lang, task: "transcribe" });
    return String(out && out.text ? out.text : "").trim();
  }

  // Qwen3 "thinks" by default; /no_think switches it to plain answers.
  function translatePrompt(text, dir, modelId) {
    let user;
    if (dir === "en2zh") {
      user =
        "Translate the English text below into natural, conversational Simplified Mandarin Chinese.\n" +
        "Answer with the Chinese translation only — one line, no pinyin, no quotes, no explanation.\n\n" +
        "English: " + text;
    } else {
      user =
        "Translate the Chinese text below into natural English.\n" +
        "Answer with the English translation only — one line, no quotes, no explanation.\n\n" +
        "中文: " + text;
    }
    if (/^Qwen3/.test(modelId)) user += "\n/no_think";
    return user;
  }

  function cleanLine(line) {
    return line
      .replace(/^\s*(?:[-*•]\s*)?(?:line\s*\d+\s*[:.)-]?\s*)?/i, "")
      .replace(/^(?:chinese|translation|pinyin|pīnyīn|english|中文|拼音)\s*[:：]\s*/i, "")
      .replace(/\*+/g, "")
      .replace(/^["'“”]+|["'“”]+$/g, "")
      .trim();
  }

  // Tone-marked pinyin is generated deterministically from the final hanzi
  // with pinyin-pro (dictionary + word segmentation, 多音字-aware). LLMs —
  // especially small ones — reliably hallucinate tones and syllables, so we
  // never ask the model for pinyin. Loaded from a CDN as global `pinyinPro`;
  // if that script ever fails to load we just show no pinyin line.
  function toPinyin(hanzi) {
    if (!hanzi || typeof pinyinPro === "undefined" || !pinyinPro.pinyin) return "";
    try {
      // nonZh:"consecutive" keeps latin/punctuation runs intact; tidy the
      // stray spaces pinyin-pro leaves around CJK punctuation (，。！？…).
      return pinyinPro.pinyin(hanzi, { toneType: "symbol", type: "string", nonZh: "consecutive" })
        .replace(/\s*([，。！？；：、…])\s*/g, "$1 ")
        .replace(/([，。！？；：、…])\s+$/, "$1")
        .trim();
    } catch (e) {
      return "";
    }
  }

  function parseTranslation(raw, dir) {
    // hide any <think>…</think> reasoning trace (DeepSeek R1, Qwen3)
    const body = String(raw).replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    const lines = body.split(/\n+/).map(cleanLine).filter(Boolean);
    if (!lines.length) return { hanzi: "", pinyin: "", english: "" };

    if (dir === "zh2en") return { hanzi: "", pinyin: "", english: lines[0] };

    const hasCjk = (s) => /[\u3400-\u9fff]/.test(s);

    // The model may still wrap a multi-sentence translation over several
    // lines — keep EVERY CJK line so no sentence is ever silently dropped.
    const hanziLines = lines.filter(hasCjk);
    const hanzi = hanziLines.length ? hanziLines.join("") : lines[0];
    return { hanzi: hanzi, pinyin: toPinyin(hanzi), english: "" };
  }

  async function translate(text, dir) {
    const reply = await ai.engine.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are a professional English–Chinese translator. Follow the requested output format exactly. Never add explanations."
        },
        { role: "user", content: translatePrompt(text, dir, ai.engineModel) }
      ],
      temperature: 0, // greedy decoding — same input, same translation every run
      max_tokens: 400
    });
    const content = reply.choices && reply.choices[0] &&
      reply.choices[0].message && reply.choices[0].message.content;
    return parseTranslation(content || "", dir);
  }

  /* ---------- voice round trip ---------- */

  function updateMicButtons() {
    if (ai.recording) {
      // only the active mic stays tappable (second tap = stop & translate)
      micEn.disabled = ai.recording.dir !== "en2zh";
      micZh.disabled = ai.recording.dir !== "zh2en";
      return;
    }
    const ready = !!(ai.engine && ai.asr) && !ai.busy;
    micEn.disabled = !ready;
    micZh.disabled = !ready;
  }

  function renderResult(dir, transcript, tr) {
    heardEl.dataset.dir = dir;
    heardEl.textContent = transcript;
    if (dir === "en2zh") {
      hanziEl.textContent = tr.hanzi;
      hanziEl.classList.toggle("hidden", !tr.hanzi);
      pinyinEl.textContent = tr.pinyin;
      pinyinEl.classList.toggle("hidden", !tr.pinyin);
      englishEl.textContent = "";
      englishEl.classList.add("hidden");
    } else {
      hanziEl.textContent = "";
      hanziEl.classList.add("hidden");
      pinyinEl.textContent = "";
      pinyinEl.classList.add("hidden");
      englishEl.textContent = tr.english;
      englishEl.classList.toggle("hidden", !tr.english);
    }
    resultEl.classList.remove("hidden");
  }

  // Transcribe + translate one recorded session.
  let processing = false;

  async function processSession(session) {
    if (processing) return;
    processing = true;
    try {
      setStatus("Transcribing…");
      const pcm = await session.stop();
      const transcript = await transcribe(pcm, session.dir);
      if (!transcript) {
        setStatus("Nothing was heard — try again a little closer to the microphone.");
        return;
      }
      renderResult(session.dir, transcript, { hanzi: "", pinyin: "", english: "" });
      setStatus("Translating…");
      const tr = await translate(transcript, session.dir);
      renderResult(session.dir, transcript, tr);
      setStatus("");
      // auto-play the translation — that's what a tourist needs hands-free
      speak(session.dir === "en2zh" ? tr.hanzi : tr.english,
        session.dir === "en2zh" ? "zh-CN" : "en-US");
    } catch (e) {
      setStatus("Voice translation failed: " + (e && e.message ? e.message : e));
    } finally {
      processing = false;
      ai.busy = false;
      updateMicButtons();
    }
  }

  // Reset the mic UI and kick off processing. Called by the stop tap,
  // and by the 15 s safety timer.
  function finishRecording(session) {
    if (ai.recording === session) {
      ai.recording = null;
      session.cancelTimer();
    }
    const btn = session.dir === "en2zh" ? micEn : micZh;
    btn.classList.remove("recording");
    btn.innerHTML = session.dir === "en2zh" ? "🎤 Speak English" : "🎤 说中文";
    hintEl.textContent =
      "Tap a microphone, say one sentence, then tap again (stops automatically after 15 s).";
    updateMicButtons();
    processSession(session);
  }

  async function runVoice(dir) {
    // busy is allowed while *recording* — the stop tap must get through.
    if (ai.busy && !ai.recording) return;

    // — recording phase (first tap) —
    if (!ai.recording) {
      if (!ai.engine || !ai.asr) {
        setStatus("Download the AI models first (button above).");
        return;
      }
      try {
        ai.recording = await startRecording(dir);
      } catch (e) {
        setStatus(e && e.name === "NotAllowedError"
          ? "Microphone permission was denied — allow it in the browser settings to use voice input."
          : "Could not start recording: " + (e && e.message ? e.message : e));
        return;
      }
      ai.busy = true;
      const btn = dir === "en2zh" ? micEn : micZh;
      btn.classList.add("recording");
      btn.innerHTML = dir === "en2zh" ? "⏹ Stop &amp; translate" : "⏹ 停止并翻译";
      updateMicButtons();
      btn.disabled = false;
      hintEl.textContent = "Listening… say one sentence, then tap again.";
      setStatus("");
      return;
    }

    // — stop & process phase (second tap) —
    finishRecording(ai.recording);
  }

  /* ---------- written translation (Translate tab) ---------- */

  // The Translate tab shares the SAME engine, model list and download
  // cache as the Voice tab — loading it once is enough for both.
  let trBusy = false;
  let trLast = { dir: "en2zh", hanzi: "", english: "" };

  function textUi() {
    return {
      status: function (m) { trAiStatusEl.textContent = m || ""; },
      progress: function (pct, text) {
        trAiProgWrap.classList.remove("hidden");
        trAiProgFill.style.width = Math.max(2, Math.min(100, Math.round(pct))) + "%";
        trAiProgText.textContent = text || "";
      }
    };
  }

  function hideTextProgress() {
    trAiProgWrap.classList.add("hidden");
    trAiProgFill.style.width = "0%";
    trAiProgText.textContent = "";
  }

  function shortName(id) {
    return String(id).replace(/-q4f16_1-MLC.*$/, "");
  }

  // Auto language detection: any Han character means Chinese -> English.
  function detectDir(text) {
    return /[\u3400-\u9fff]/.test(text) ? "zh2en" : "en2zh";
  }

  function renderTextResult(dir, tr) {
    trAiResult.classList.remove("hidden");
    $("trAiDir").textContent = dir === "en2zh" ? "English → 中文" : "中文 → English";
    trAiHanzi.textContent = tr.hanzi || "";
    trAiPinyin.textContent = tr.pinyin || "";
    trAiEnglish.textContent = tr.english || "";
    trAiHanzi.classList.toggle("hidden", !tr.hanzi);
    trAiPinyin.classList.toggle("hidden", !tr.pinyin);
    trAiEnglish.classList.toggle("hidden", !tr.english);
    trLast = { dir: dir, hanzi: tr.hanzi, english: tr.english };
    trAiSpeak.classList.toggle("hidden", !(dir === "en2zh" ? tr.hanzi : tr.english));
  }

  async function runTextAi() {
    const q = trInput.value.trim();
    if (!q) {
      trAiStatusEl.textContent = "Type a word or sentence first.";
      return;
    }
    if (trBusy) return;
    trBusy = true;
    trAiBtn.disabled = true;
    trAiStatusEl.textContent = "";
    const dir = detectDir(q);
    try {
      // Loads (or reloads) the shared engine if needed — first use shows
      // the one-time download progress right here in the Translate tab.
      await ensureEngine(trAiSelect.value, textUi());
      trAiStatusEl.textContent = "Translating with " + shortName(ai.engineModel) + "…";
      const tr = await translate(q, dir);
      renderTextResult(dir, tr);
      trAiStatusEl.textContent = "";
    } catch (e) {
      trAiStatusEl.textContent =
        "AI translation failed: " + (e && e.message ? e.message : e);
    } finally {
      trBusy = false;
      trAiBtn.disabled = false;
      hideTextProgress();
    }
  }

  trAiBtn.addEventListener("click", runTextAi);
  trAiSelect.addEventListener("change", () => syncModelSelections(trAiSelect));
  // Enter in the search box runs the dictionary lookup (translate.js)
  // AND the AI sentence translation.
  trInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runTextAi();
  });
  trAiSpeak.addEventListener("click", () => {
    const t = trLast.dir === "en2zh" ? trLast.hanzi : trLast.english;
    speak(t, trLast.dir === "en2zh" ? "zh-CN" : "en-US");
  });

  /* ---------- init ---------- */

  function populateSelects() {
    const trPref = loadPref(MODEL_KEY, TRANSLATION_MODELS[0].id);
    const asrPref = loadPref(VOICE_KEY, VOICE_MODELS[0].id);

    const trOptions = TRANSLATION_MODELS.map((m) =>
      '<option value="' + esc(m.id) + '"' + (m.id === trPref ? " selected" : "") + ">" +
      esc(m.label) + " · " + esc(m.size) + "</option>").join("");
    trSelect.innerHTML = trOptions;
    if (trAiSelect) trAiSelect.innerHTML = trOptions;
    asrSelect.innerHTML = VOICE_MODELS.map((m) =>
      '<option value="' + esc(m.id) + '"' + (m.id === asrPref ? " selected" : "") + ">" +
      esc(m.label) + " · " + esc(m.size) + "</option>").join("");

    $("vcTrNote").textContent =
      (TRANSLATION_MODELS.find((m) => m.id === trSelect.value) || {}).note || "";
    $("vcAsrNote").textContent =
      (VOICE_MODELS.find((m) => m.id === asrSelect.value) || {}).note || "";
  }

  // Both model selects (Voice tab + Translate tab) share one stored
  // preference and one engine, so they are always kept in sync.
  function modelNote(id) {
    return (TRANSLATION_MODELS.find((m) => m.id === id) || {}).note || "";
  }

  function syncModelSelections(source) {
    const id = source.value;
    savePref(MODEL_KEY, id);
    if (trSelect !== source) trSelect.value = id;
    if (trAiSelect && trAiSelect !== source) trAiSelect.value = id;
    $("vcTrNote").textContent = modelNote(id);
    if (trAiNoteEl) trAiNoteEl.textContent = modelNote(id);
    if (ai.engineModel && ai.engineModel !== id) {
      readyBadge.textContent = "model changed — reload";
    }
  }

  trSelect.addEventListener("change", () => syncModelSelections(trSelect));

  asrSelect.addEventListener("change", () => {
    savePref(VOICE_KEY, asrSelect.value);
    $("vcAsrNote").textContent =
      (VOICE_MODELS.find((m) => m.id === asrSelect.value) || {}).note || "";
    if (ai.asrModel && ai.asrModel !== asrSelect.value) {
      readyBadge.textContent = "model changed — reload";
    }
  });

  loadBtn.addEventListener("click", loadModels);
  micEn.addEventListener("click", () => runVoice("en2zh"));
  micZh.addEventListener("click", () => runVoice("zh2en"));
  listenBtn.addEventListener("click", () => {
    const dir = heardEl.dataset.dir || "en2zh";
    const text = dir === "en2zh" ? hanziEl.textContent : englishEl.textContent;
    speak(text, dir === "en2zh" ? "zh-CN" : "en-US");
  });

  populateSelects();
  updateMicButtons();

  // Voice availability warning — WebGPU is required by WebLLM.
  if (!navigator.gpu) {
    warnEl.classList.remove("hidden");
    warnEl.innerHTML =
      "⚠️ This browser has no <strong>WebGPU</strong> support, so the on-device translation model " +
      "cannot run here. Speech recognition may still work on CPU. " +
      "Use Chrome on Android (or a desktop Chrome/Edge) for the full offline experience.";
  }

  // The nav code (translate.js) calls this when the Voice tab is opened.
  window.TCVoice = {
    onShow: () => {
      updateStorage();
      updateMicButtons();
    }
  };
})();
