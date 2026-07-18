const fs = require("fs");
const path = require("path");
const vm = require("vm");

let PDFParse;
try {
  ({ PDFParse } = require("./pdf-extract/node_modules/pdf-parse"));
} catch (error) {
  console.error("Missing pdf-parse. Run: npm --prefix tools/pdf-extract install");
  process.exit(1);
}

const ROOT = path.resolve(__dirname, "..");
const VOCAB_PATH = path.join(ROOT, "web", "data", "vocab.js");
const LEVELS = ["N5", "N4", "N3", "N2", "N1"];
const LEVEL_ORDER = Object.fromEntries(LEVELS.map((level, index) => [level, index]));
const KANJI_RE = /[\u3400-\u9fff々]/gu;
const ENTRY_RE = /^(.+?)\s+(N[1-5]),\s*(.+)$/u;

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeKeyPart(value) {
  return cleanText(value).normalize("NFKC").replace(/\s+/g, "");
}

function kanjiStem(value) {
  return (String(value || "").match(KANJI_RE) || []).join("");
}

function loadExistingVocab() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(VOCAB_PATH, "utf8"), sandbox, { filename: VOCAB_PATH });
  if (!Array.isArray(sandbox.window.JLPT_VOCAB)) {
    throw new Error("web/data/vocab.js did not define window.JLPT_VOCAB");
  }
  return sandbox.window.JLPT_VOCAB;
}

function parsePdfEntry(line, sourceIndex) {
  const match = cleanText(line).match(ENTRY_RE);
  if (!match) {
    return null;
  }

  const term = cleanText(match[1]);
  const level = match[2];
  const meaning = cleanText(match[3]);
  const bracketMatch = term.match(/^(.*?)\[(.+)\]$/u);
  let reading;
  let surface = "";
  let kanji;

  if (bracketMatch) {
    reading = cleanText(bracketMatch[1]);
    surface = cleanText(bracketMatch[2]);
    kanji = kanjiStem(surface) || surface;
  } else {
    reading = term;
    kanji = term;
  }

  const entry = { sourceIndex, level, kanji, reading, meaning };
  if (surface && surface !== kanji) {
    entry.surface = surface;
  }
  return entry;
}

async function extractPdfEntries(pdfPath) {
  const parser = new PDFParse({ data: fs.readFileSync(pdfPath) });
  const result = await parser.getText();
  await parser.destroy();

  return result.text
    .split(/\r?\n/)
    .map((line, index) => parsePdfEntry(line, index))
    .filter(Boolean);
}

function wordKeys(word) {
  const reading = normalizeKeyPart(word.reading);
  const values = [word.surface || word.kanji, word.kanji];
  return Array.from(new Set(
    values
      .map(normalizeKeyPart)
      .filter(Boolean)
      .map((value) => `${value}|${reading}`)
  ));
}

function idLevel(id) {
  const match = String(id || "").match(/^n([1-5])-\d+$/);
  return match ? `N${match[1]}` : "";
}

function idNumber(id) {
  const match = String(id || "").match(/^n[1-5]-(\d+)$/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function nextIdIndexes(words) {
  const indexes = Object.fromEntries(LEVELS.map((level) => [level, 0]));
  for (const word of words) {
    const level = idLevel(word.id);
    if (!level) {
      continue;
    }
    indexes[level] = Math.max(indexes[level], idNumber(word.id));
  }
  return indexes;
}

function formatId(level, index) {
  return `n${level.slice(1)}-${String(index).padStart(4, "0")}`;
}

function indexExistingByKey(words) {
  const byKey = new Map();
  words.forEach((word, index) => {
    for (const key of wordKeys(word)) {
      if (!byKey.has(key)) {
        byKey.set(key, []);
      }
      byKey.get(key).push({ word, index });
    }
  });
  return byKey;
}

function findExistingMatch(entry, byKey, consumedIds) {
  const candidates = [];
  const seenIds = new Set();
  for (const key of wordKeys(entry)) {
    for (const candidate of byKey.get(key) || []) {
      if (consumedIds.has(candidate.word.id) || seenIds.has(candidate.word.id)) {
        continue;
      }
      candidates.push(candidate);
      seenIds.add(candidate.word.id);
    }
  }

  candidates.sort((left, right) => {
    const leftLevel = left.word.level === entry.level ? 0 : 1;
    const rightLevel = right.word.level === entry.level ? 0 : 1;
    if (leftLevel !== rightLevel) {
      return leftLevel - rightLevel;
    }

    const entryMeaning = normalizeKeyPart(entry.meaning);
    const leftMeaning = normalizeKeyPart(left.word.meaning) === entryMeaning ? 0 : 1;
    const rightMeaning = normalizeKeyPart(right.word.meaning) === entryMeaning ? 0 : 1;
    if (leftMeaning !== rightMeaning) {
      return leftMeaning - rightMeaning;
    }

    return left.index - right.index;
  });

  return candidates[0] ? candidates[0].word : null;
}

function buildWord(id, entry, existingWord) {
  const word = {
    id,
    level: entry.level,
    kanji: entry.kanji
  };
  if (entry.surface) {
    word.surface = entry.surface;
  }
  word.reading = entry.reading;
  word.meaning = entry.meaning;
  if (existingWord && existingWord.pos) {
    word.pos = existingWord.pos;
  }
  return word;
}

function sortVocab(words) {
  return words.slice().sort((left, right) => {
    const levelDiff = LEVEL_ORDER[left.level] - LEVEL_ORDER[right.level];
    if (levelDiff) {
      return levelDiff;
    }
    const numberDiff = idNumber(left.id) - idNumber(right.id);
    if (numberDiff) {
      return numberDiff;
    }
    return left.id.localeCompare(right.id);
  });
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

function countByLevel(words) {
  return words.reduce((counts, word) => {
    counts[word.level] = (counts[word.level] || 0) + 1;
    return counts;
  }, {});
}

function validate(words) {
  const ids = new Set();
  for (const word of words) {
    if (ids.has(word.id)) {
      throw new Error(`Duplicate id: ${word.id}`);
    }
    ids.add(word.id);
    if (idLevel(word.id) !== word.level) {
      throw new Error(`ID level does not match word level: ${word.id} ${word.level}`);
    }
  }
}

async function main() {
  const pdfPath = process.argv[2];
  if (!pdfPath) {
    throw new Error("Usage: node tools/update-vocab-from-combined-pdf.js <pdf-path>");
  }

  const existing = loadExistingVocab();
  const entries = await extractPdfEntries(pdfPath);
  const nextIndexes = nextIdIndexes(existing);
  const byKey = indexExistingByKey(existing);
  const consumedIds = new Set();
  const finalWords = [];
  const stats = {
    pdfEntries: entries.length,
    existingEntries: existing.length,
    matchedSameLevel: 0,
    movedLevel: 0,
    added: 0,
    missingFromPdf: 0
  };

  for (const entry of entries) {
    const existingWord = findExistingMatch(entry, byKey, consumedIds);
    if (existingWord) {
      consumedIds.add(existingWord.id);
      if (existingWord.level === entry.level) {
        stats.matchedSameLevel += 1;
        finalWords.push(buildWord(existingWord.id, entry, existingWord));
      } else {
        stats.movedLevel += 1;
        nextIndexes[entry.level] += 1;
        finalWords.push(buildWord(formatId(entry.level, nextIndexes[entry.level]), entry, existingWord));
      }
      continue;
    }

    stats.added += 1;
    nextIndexes[entry.level] += 1;
    finalWords.push(buildWord(formatId(entry.level, nextIndexes[entry.level]), entry, null));
  }

  stats.missingFromPdf = existing.filter((word) => !consumedIds.has(word.id)).length;
  const sortedWords = sortVocab(finalWords);
  validate(sortedWords);
  writeVocab(sortedWords);

  const finalIds = new Set(sortedWords.map((word) => word.id));
  const vacatedIds = existing.filter((word) => !finalIds.has(word.id)).map((word) => word.id);
  console.log(JSON.stringify({
    ...stats,
    finalEntries: sortedWords.length,
    byLevel: countByLevel(sortedWords),
    originalMaxIdIndex: nextIdIndexes(existing),
    finalMaxIdIndex: nextIdIndexes(sortedWords),
    vacatedIdCount: vacatedIds.length,
    vacatedIdSamples: vacatedIds.slice(0, 20)
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
