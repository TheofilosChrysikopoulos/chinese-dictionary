/* =========================================================
 * build-dict.js — builds data/dict.json for the translator
 * ---------------------------------------------------------
 * Sources (both free / CC BY-SA):
 *   cedict.txt   - CC-CEDICT from MDBG (hanzi + pinyin + English)
 *   wordlist.txt - MOE 现代汉语常用词表 (frequency ranks, 56k words)
 *
 * Output: data/dict.json  { count, words: [[english, hanzi, pinyin], ...] }
 *   sorted by usage frequency (most common first).
 * Usage: node build-dict.js [maxEntries]
 * ========================================================= */

const fs = require("fs");
const MAX = parseInt(process.argv[2] || "20000", 10);

/* ---------- pinyin: tone numbers -> tone marks ---------- */
const MARKS = {
  a: "āáǎà", e: "ēéěè", i: "īíǐì",
  o: "ōóǒò", u: "ūúǔù", ü: "ǖǘǚǜ"
};

function toneSyllable(syl) {
  let tone = 5;
  const m = syl.match(/([1-5])$/);
  if (m) { tone = +m[1]; syl = syl.slice(0, -1); }
  syl = syl.replace(/u:/g, "ü").replace(/v/g, "ü").toLowerCase();
  if (tone === 5) return syl;

  const chars = [...syl];
  const vowels = [];
  chars.forEach((c, i) => { if (c in MARKS) vowels.push({ c, i }); });
  if (!vowels.length) return syl;

  const str = vowels.map((v) => v.c).join("");
  let target;
  if (str.includes("a")) target = vowels[str.indexOf("a")];
  else if (str.includes("o")) target = vowels[str.indexOf("o")];
  else if (str.includes("e")) target = vowels[str.indexOf("e")];
  else if (vowels.length >= 2) target = vowels[1]; // iu / ui / üe...
  else target = vowels[0];

  chars[target.i] = MARKS[target.c][tone - 1];
  return chars.join("");
}

function tonePinyin(raw) {
  // raw like "Zhong1 guo2" or "ni3 hao3" or "hua1'r5"
  return raw
    .split(/[ ']+/)
    .filter(Boolean)
    .map(toneSyllable)
    .join(" ");
}

/* ---------- 1. frequency ranks + correct reading (MOE word list) ---------- */
const toneless = (s) => s.toLowerCase().replace(/[^a-z:ü]/g, "").replace(/u:/g, "v");
const ranks = new Map(); // hanzi -> { py, rank }
for (const line of fs.readFileSync("wordlist.txt", "utf8").split(/\r?\n/)) {
  const parts = line.split("\t");
  if (parts.length < 3) continue;
  const hz = parts[0];
  const r = parseInt(parts[2], 10);
  if (!hz || !Number.isFinite(r)) continue;
  const py = toneless(parts[1] || "");
  const prev = ranks.get(hz);
  if (!prev || r < prev.rank) ranks.set(hz, { py, rank: r });
}
console.log("wordlist ranks:", ranks.size);

/* ---------- 2. CC-CEDICT entries ---------- */
const LINE = /^(\S+) (\S+) \[(.+?)\] \/(.+)\/$/;
const HANZI = /^[\u4e00-\u9fff]+$/;
const BAD_GLOSS = /^(surname|used in|variant of|see |old variant|capital)/i;

function cleanGloss(g) {
  g = g.trim();
  g = g.replace(/\[[^\]]*\]/g, " ");           // cross-references
  g = g.replace(/\(as in[^)]*\)?/gi, " ");     // "(as in ...)" examples
  g = g.replace(/\((?:variant|also|see|abbr|short)[^)]*\)/gi, " ");
  g = g.replace(/\s+/g, " ").replace(/[;,]$/, "").trim();
  return g;
}

function glossQuality(g) {
  if (BAD_GLOSS.test(g)) return 2;       // marginal sense
  if (/^[A-Z]/.test(g)) return 1;        // proper-noun-ish gloss
  return 0;                              // ordinary sense — best
}

const entries = []; // { simp, en, py, rank, quality, readingOk }
for (const line of fs.readFileSync("cedict.txt", "utf8").split(/\r?\n/)) {
  if (line.startsWith("#")) continue;
  const m = LINE.exec(line);
  if (!m) continue;
  const [, , simp, rawPy, body] = m;
  if (!HANZI.test(simp)) continue;
  const r = ranks.get(simp);
  if (!r) continue; // not a ranked common word

  let glosses = body.split("/")
    .map(cleanGloss)
    .filter((g) => g && g.length >= 2 && !/^CL:/.test(g));
  // drop label-led senses ("(slang) ...", "(Tw) ...") if we have better ones
  if (glosses.length > 1) {
    const plain = glosses.filter((g) => g[0] !== "(");
    if (plain.length) glosses = plain;
  }
  glosses = glosses.slice(0, 2);
  if (!glosses.length) continue;

  let en = glosses.join("; ");
  if (en.length > 90) { // cut at the last complete sense
    en = en.slice(0, 90);
    const cut = Math.max(en.lastIndexOf(";"), en.lastIndexOf(","));
    if (cut > 30) en = en.slice(0, cut);
  }
  const py = tonePinyin(rawPy);
  if (!py) continue;

  entries.push({
    simp, en, py,
    rank: r.rank,
    quality: glossQuality(glosses[0]),
    readingOk: toneless(rawPy) === r.py
  });
}

/* ---------- 3. dedupe: prefer correct reading, then quality/rank ---------- */
const byWord = new Map();
for (const e of entries) {
  const prev = byWord.get(e.simp);
  const better = (a, b) => a.readingOk !== b.readingOk ? a.readingOk :
    a.quality !== b.quality ? a.quality < b.quality :
    a.rank < b.rank;
  if (!prev || better(e, prev)) byWord.set(e.simp, e);
}

/* ---------- 3b. merge the curated 1,000 tourist words (top priority) ------
 * The MOE word list contains single words only, so phrases like 你好 or
 * 多少钱 are missing from CEDICT-matched entries. The curated flashcard
 * dictionary guarantees all tourist-critical entries exist.               */
const CAT_FILES = ["categories", "cat1", "cat2", "cat3", "cat4", "cat5",
  "cat6", "cat7", "cat8", "cat9", "cat10"];
const src = CAT_FILES
  .map((f) => fs.readFileSync(`data/${f}.js`, "utf8"))
  .join("\n")
  .replace(/const CATEGORIES\s*=\s*\[\]\s*;?/, "");
const CATEGORIES = [];
new Function("CATEGORIES", src)(CATEGORIES);
let curated = 0;
for (const cat of CATEGORIES) {
  for (const [en, hz, py] of cat.words) {
    if (!en || !hz || !py) continue;
    byWord.set(hz, { simp: hz, en, py, rank: 1, quality: 0, readingOk: true });
    curated++;
  }
}
console.log("curated words merged:", curated);

/* ---------- 4. sort, write ---------- */
const words = [...byWord.values()]
  .sort((a, b) => a.rank - b.rank)
  .slice(0, MAX)
  .map((e) => [e.en, e.simp, e.py]);

const out = { count: words.length, words };
fs.mkdirSync("data", { recursive: true });
fs.writeFileSync("data/dict.json", JSON.stringify(out));

const kb = (fs.statSync("data/dict.json").size / 1024).toFixed(0);
console.log(`matched: ${entries.length}, unique: ${byWord.size}`);
console.log(`data/dict.json: ${words.length} entries, ${kb} KB`);
console.log("top 12:", JSON.stringify(words.slice(0, 12), null, 0));

