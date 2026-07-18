const fs = require("fs");
const path = require("path");

let PDFParse;
try {
  ({ PDFParse } = require("./pdf-extract/node_modules/pdf-parse"));
} catch (error) {
  console.error("Missing pdf-parse. Run: npm --prefix tools/pdf-extract install");
  process.exit(1);
}

const ROOT = path.resolve(__dirname, "..");
const PDF_DIR = path.join(__dirname, "pagoda-pdfs");
const VOCAB_PATH = path.join(ROOT, "web", "data", "vocab.js");
const LEVELS = ["N3", "N2", "N1"];
const MANUAL_REPAIR_ENTRIES = [
  { level: "N3", kanji: "改札口", reading: "かいさつぐち", meaning: "개찰구", pos: "명사" },
  { level: "N3", kanji: "倍", reading: "ばい", meaning: "~배", pos: "명사" },
  { level: "N1", kanji: "免", surface: "免れる", reading: "まぬかれる", meaning: "면하다, 모면하다", pos: "동사" }
];
const KANA_RE = /[\u3040-\u30ff]/u;
const KANJI_RE = /[\u3400-\u9fff々]/u;
const ENTRY_RE = /^\s*(\d{1,3})\s*□\s+(.+?)\s+([ぁ-んァ-ンー]+)\s+(.+?)\s*$/u;

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[｜|]/g, "")
    .trim();
}

function kanjiStem(surface) {
  return Array.from(surface)
    .filter((char) => /[\u3400-\u9fff々]/u.test(char))
    .join("");
}

function inferPos(surface, meaning) {
  if (surface.endsWith("する") || /[うくぐすつぬぶむる]$/u.test(surface)) {
    return "동사";
  }

  if (surface.endsWith("い") || /하다$|스럽다$|롭다$|없다$|좋다$|나쁘다$/u.test(meaning)) {
    return "형용사";
  }

  if (surface.endsWith("に") || surface.endsWith("と") || /히$|게$|로$/u.test(meaning)) {
    return "부사";
  }

  return "명사";
}

async function extractPdfEntries(level) {
  const filePath = path.join(PDF_DIR, `MKT_JLPT_word-${level}.pdf`);
  const parser = new PDFParse({ data: fs.readFileSync(filePath) });
  const result = await parser.getText();
  await parser.destroy();

  const bySurfaceReading = new Map();
  const lines = result.text.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(ENTRY_RE);
    if (!match) {
      continue;
    }

    const surface = cleanText(match[2]);
    const reading = cleanText(match[3]);
    const meaning = cleanText(match[4]);
    const stem = kanjiStem(surface);
    if (!surface || !reading || !meaning || !KANJI_RE.test(stem)) {
      continue;
    }

    const key = `${surface}|${reading}`;
    if (!bySurfaceReading.has(key)) {
      bySurfaceReading.set(key, {
        level,
        kanji: stem,
        surface: surface === stem ? "" : surface,
        reading,
        meaning,
        pos: inferPos(surface, meaning)
      });
    }
  }

  return Array.from(bySurfaceReading.values());
}

function loadExistingVocab() {
  globalThis.window = {};
  const code = fs.readFileSync(VOCAB_PATH, "utf8");
  // vocab.js is local project data, not arbitrary input.
  eval(code);
  return window.JLPT_VOCAB;
}

function normalizeKeyPart(value) {
  return cleanText(value).replace(/[・･]/g, "");
}

function existingKeys(words) {
  const keys = new Set();
  for (const word of words) {
    const surface = normalizeKeyPart(word.surface || word.kanji);
    const kanji = normalizeKeyPart(word.kanji);
    const reading = normalizeKeyPart(word.reading);
    keys.add(`${surface}|${reading}`);
    keys.add(`${kanji}|${reading}`);
  }
  return keys;
}

function nextIdIndexes(words) {
  const indexes = {};
  for (const level of ["N5", "N4", "N3", "N2", "N1"]) {
    indexes[level] = 0;
  }

  for (const word of words) {
    const match = String(word.id || "").match(/^n([1-5])-(\d+)$/);
    if (!match) {
      continue;
    }
    const level = `N${match[1]}`;
    indexes[level] = Math.max(indexes[level] || 0, Number(match[2]));
  }

  return indexes;
}

function toVocabLine(word) {
  const data = {
    id: word.id,
    level: word.level,
    kanji: word.kanji
  };
  if (word.surface) {
    data.surface = word.surface;
  }
  data.reading = word.reading;
  data.meaning = word.meaning;
  if (word.pos) {
    data.pos = word.pos;
  }
  return `  ${JSON.stringify(data)}`;
}

function writeVocab(words) {
  const lines = ["window.JLPT_VOCAB = ["];
  words.forEach((word, index) => {
    lines.push(`${toVocabLine(word)}${index === words.length - 1 ? "" : ","}`);
  });
  lines.push("];");
  fs.writeFileSync(VOCAB_PATH, `${lines.join("\n")}\n`, "utf8");
}

async function main() {
  const existing = loadExistingVocab();
  const keys = existingKeys(existing);
  const nextIndexes = nextIdIndexes(existing);
  const added = [];
  const parsedByLevel = {};
  const duplicateByLevel = {};

  for (const level of LEVELS) {
    const entries = await extractPdfEntries(level);
    parsedByLevel[level] = entries.length;
    duplicateByLevel[level] = 0;

    for (const entry of entries) {
      const surfaceKey = normalizeKeyPart(entry.surface || entry.kanji);
      const kanjiKey = normalizeKeyPart(entry.kanji);
      const reading = normalizeKeyPart(entry.reading);
      if (keys.has(`${surfaceKey}|${reading}`) || keys.has(`${kanjiKey}|${reading}`)) {
        duplicateByLevel[level] += 1;
        continue;
      }

      nextIndexes[level] += 1;
      entry.id = `n${level.slice(1)}-${String(nextIndexes[level]).padStart(4, "0")}`;
      keys.add(`${surfaceKey}|${reading}`);
      keys.add(`${kanjiKey}|${reading}`);
      added.push(entry);
    }
  }

  for (const entry of MANUAL_REPAIR_ENTRIES) {
    const surfaceKey = normalizeKeyPart(entry.surface || entry.kanji);
    const kanjiKey = normalizeKeyPart(entry.kanji);
    const reading = normalizeKeyPart(entry.reading);
    if (keys.has(`${surfaceKey}|${reading}`) || keys.has(`${kanjiKey}|${reading}`)) {
      continue;
    }

    nextIndexes[entry.level] += 1;
    entry.id = `n${entry.level.slice(1)}-${String(nextIndexes[entry.level]).padStart(4, "0")}`;
    keys.add(`${surfaceKey}|${reading}`);
    keys.add(`${kanjiKey}|${reading}`);
    added.push(entry);
  }

  writeVocab([...existing, ...added]);
  console.log(JSON.stringify({
    parsedByLevel,
    duplicateByLevel,
    addedByLevel: added.reduce((acc, word) => {
      acc[word.level] = (acc[word.level] || 0) + 1;
      return acc;
    }, {}),
    addedTotal: added.length,
    finalTotal: existing.length + added.length
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
