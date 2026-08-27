// Verification script: run with `node verify.js`
// Checks that every category has exactly 100 words, every word has 3 non-empty
// fields, and there are no duplicate hanzi or English entries across categories.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const sandbox = { CATEGORIES: [] };
vm.createContext(sandbox);
const files = fs
  .readdirSync(path.join(__dirname, "data"))
  .filter((f) => /^cat\d+\.js$/.test(f))
  .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
files.forEach((f) =>
  vm.runInContext(fs.readFileSync(path.join(__dirname, "data", f), "utf8"), sandbox)
);

const cats = sandbox.CATEGORIES;
let total = 0;
let ok = true;

const seenHanzi = new Map();
const seenEnglish = new Map();

cats.forEach((cat) => {
  const n = cat.words.length;
  total += n;
  if (n !== 100) {
    ok = false;
    console.log(`FAIL: "${cat.name}" has ${n} words (expected 100)`);
  }
  cat.words.forEach(([en, hz, py], i) => {
    if (!en || !hz || !py) {
      ok = false;
      console.log(`FAIL: "${cat.name}" word #${i + 1} has an empty field:`, [en, hz, py]);
    }
    if (seenHanzi.has(hz) && seenHanzi.get(hz) !== cat.name) {
      console.log(`DUP HANZI: ${hz} in "${seenHanzi.get(hz)}" and "${cat.name}"`);
      ok = false;
    } else seenHanzi.set(hz, cat.name);
    const key = en.toLowerCase();
    if (seenEnglish.has(key) && seenEnglish.get(key) !== cat.name) {
      console.log(`DUP ENGLISH: "${en}" in "${seenEnglish.get(key)}" and "${cat.name}"`);
      ok = false;
    } else seenEnglish.set(key, cat.name);
  });
});

console.log(`Categories: ${cats.length}`);
cats.forEach((c) => console.log(`  ${c.icon} ${c.name}: ${c.words.length} words`));
console.log(`Total words: ${total}`);
console.log(ok && total === 1000 ? "ALL CHECKS PASSED ✔" : "CHECKS FAILED ✘");
process.exit(ok && total === 1000 ? 0 : 1);
