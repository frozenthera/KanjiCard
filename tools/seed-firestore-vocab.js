const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const vocabPath = path.join(root, "web", "data", "vocab.js");
const outDir = path.join(root, "dist");
const outPath = path.join(outDir, "firestore-vocab-seed.json");
const projectId = process.env.FIREBASE_PROJECT_ID || "";
const accessToken = process.env.GOOGLE_OAUTH_ACCESS_TOKEN || "";
const pruneStaleVocab = process.env.FIREBASE_PRUNE_STALE_VOCAB === "true";

function loadVocab() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(vocabPath, "utf8"), sandbox, { filename: vocabPath });
  if (!Array.isArray(sandbox.window.JLPT_VOCAB)) {
    throw new Error("web/data/vocab.js did not define window.JLPT_VOCAB");
  }
  return sandbox.window.JLPT_VOCAB;
}

function checksumFor(words) {
  return crypto
    .createHash("sha256")
    .update(words.map((word) => word.id).sort().join("\n"))
    .digest("hex");
}

function firestoreValue(value) {
  if (typeof value === "number") {
    return { integerValue: String(value) };
  }
  if (typeof value === "boolean") {
    return { booleanValue: value };
  }
  return { stringValue: String(value || "") };
}

function documentWrite(name, fields) {
  return {
    update: {
      name,
      fields: Object.fromEntries(
        Object.entries(fields).map(([key, value]) => [key, firestoreValue(value)])
      )
    }
  };
}

function documentDelete(name) {
  return { delete: name };
}

function buildSeed(words) {
  const checksum = checksumFor(words);
  const generatedAt = new Date().toISOString();
  return {
    generatedAt,
    checksum,
    count: words.length,
    vocab: words.map((word) => ({
      id: word.id,
      level: word.level,
      kanji: word.kanji,
      reading: word.reading,
      meaning: word.meaning,
      pos: word.pos || "",
      surface: word.surface || ""
    }))
  };
}

async function batchWrite(writes) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:batchWrite`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ writes })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Firestore batchWrite failed ${response.status}: ${body}`);
  }
}

async function listExistingVocabIds() {
  const ids = [];
  let pageToken = "";

  do {
    const url = new URL(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/vocab`);
    url.searchParams.set("pageSize", "1000");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Firestore vocab list failed ${response.status}: ${body}`);
    }

    const body = await response.json();
    for (const document of body.documents || []) {
      ids.push(document.name.split("/").pop());
    }
    pageToken = body.nextPageToken || "";
  } while (pageToken);

  return ids;
}

async function uploadSeed(seed) {
  const base = `projects/${projectId}/databases/(default)/documents`;
  const currentIds = new Set(seed.vocab.map((word) => word.id));
  const staleIds = pruneStaleVocab
    ? (await listExistingVocabIds()).filter((id) => !currentIds.has(id))
    : [];
  const writes = [
    documentWrite(`${base}/system/vocabVersion`, {
      checksum: seed.checksum,
      count: seed.count,
      generatedAt: seed.generatedAt
    }),
    ...seed.vocab.map((word) => documentWrite(`${base}/vocab/${word.id}`, word)),
    ...staleIds.map((id) => documentDelete(`${base}/vocab/${id}`))
  ];

  const chunkSize = 200;
  for (let index = 0; index < writes.length; index += chunkSize) {
    await batchWrite(writes.slice(index, index + chunkSize));
  }

  return { staleDeleted: staleIds.length };
}

async function main() {
  const seed = buildSeed(loadVocab());
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(seed, null, 2)}\n`);

  if (!projectId || !accessToken) {
    console.log(`Wrote ${outPath}`);
    console.log("Set FIREBASE_PROJECT_ID and GOOGLE_OAUTH_ACCESS_TOKEN to upload it.");
    return;
  }

  const result = await uploadSeed(seed);
  console.log(`Seeded ${seed.count} vocab docs and system/vocabVersion in ${projectId}`);
  if (pruneStaleVocab) {
    console.log(`Deleted ${result.staleDeleted} stale vocab docs from ${projectId}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
