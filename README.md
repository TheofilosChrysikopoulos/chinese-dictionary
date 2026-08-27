# 🇨🇳 Tourist Chinese — 1000 Survival Words

A simple, mobile-friendly flashcard web app for learning 1,000 basic Mandarin Chinese
words for tourists. Each word comes in three formats: **English · 汉字 Hanzi · Pīnyīn**.

## Categories (10 × 100 words)

| | Category |
|---|----------|
| 👋 | Greetings & Meeting People |
| 🔢 | Numbers & Counting |
| 🍜 | Food & Drinks |
| 🥢 | Restaurant & Dining |
| 🧭 | Directions & Transportation |
| 🛍️ | Shopping & Money |
| ✈️ | Travel & Sightseeing |
| 🕐 | Time & Calendar |
| 🏥 | Health & Emergency |
| 🏠 | Everyday Basics |

## Practice modes

- **Sequential**: view a category's 100 words in order (1 → 2 → 3…)
- **Random**: shuffled words from one category
- **Whole Dictionary**: random words from all 1,000

Flashcards: tap or press **Space** to flip. Arrow keys navigate. 🔊 button speaks
the word (browser Chinese voice).

## Run locally

Just open `index.html` in a browser — no build step, no dependencies.

## Verify the dictionary

```
node verify.js
```

Checks that every category has exactly 100 words, all fields are non-empty,
and there are no duplicates across the dictionary.
