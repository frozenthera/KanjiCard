const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const LEVELS = ["N5", "N4", "N3", "N2", "N1"];
const ELEMENT_IDS = [
  "deckSummary",
  "accountPanel",
  "authStatus",
  "syncStatus",
  "signInButton",
  "signOutButton",
  "studyTabButton",
  "mistakeTabButton",
  "settingsTabButton",
  "studyPanel",
  "mistakePanel",
  "settingsPanel",
  "mistakeSummary",
  "mistakeLevelFilters",
  "mistakeList",
  "levelToggles",
  "newRatioSlider",
  "newRatioInput",
  "dailyStudySizeInput",
  "resetProgressButton",
  "sessionProgressBar",
  "cardStage",
  "wordCard",
  "kanjiText",
  "levelBadge",
  "answerPanel",
  "answerReading",
  "answerMeaning",
  "answerStats",
  "nextButton",
  "studyNewSessionButton",
  "choiceButtons",
  "unknownButton",
  "knownButton",
  "progressStat",
  "knownStat",
  "unknownStat"
];

function createClassList(element) {
  const classes = new Set();

  function sync() {
    element.className = Array.from(classes).join(" ");
  }

  return {
    add(...names) {
      names.forEach((name) => classes.add(name));
      sync();
    },
    remove(...names) {
      names.forEach((name) => classes.delete(name));
      sync();
    },
    toggle(name, force) {
      const shouldAdd = force === undefined ? !classes.has(name) : Boolean(force);
      if (shouldAdd) {
        classes.add(name);
      } else {
        classes.delete(name);
      }
      sync();
      return shouldAdd;
    },
    contains(name) {
      return classes.has(name);
    }
  };
}

function createStyle() {
  const values = {};
  return {
    set width(value) {
      values.width = value;
    },
    get width() {
      return values.width || "";
    },
    set transform(value) {
      values.transform = value;
    },
    get transform() {
      return values.transform || "";
    },
    setProperty(name, value) {
      values[name] = value;
    },
    removeProperty(name) {
      delete values[name];
    }
  };
}

function createElement(tagName = "div") {
  const element = {
    tagName: tagName.toUpperCase(),
    children: [],
    attributes: {},
    listeners: {},
    className: "",
    hidden: false,
    textContent: "",
    value: "",
    type: "",
    style: createStyle(),
    clientWidth: 500,
    clientHeight: 180,
    scrollWidth: 0,
    scrollHeight: 0,
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    append(...items) {
      items.forEach((item) => this.appendChild(item));
    },
    addEventListener(type, handler) {
      this.listeners[type] = this.listeners[type] || [];
      this.listeners[type].push(handler);
    },
    dispatch(type, event = {}) {
      for (const handler of this.listeners[type] || []) {
        handler({ ...event, type, target: this });
      }
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return this.attributes[name];
    },
    setPointerCapture() {},
    releasePointerCapture() {}
  };

  Object.defineProperty(element, "innerHTML", {
    get() {
      return "";
    },
    set() {
      element.children = [];
    }
  });

  element.classList = createClassList(element);
  return element;
}

function createStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
    snapshot() {
      return { ...data };
    }
  };
}

function loadApp(storageSeed = {}, windowOverrides = {}) {
  const elements = {};
  for (const id of ELEMENT_IDS) {
    elements[id] = createElement();
  }

  const document = {
    documentElement: createElement("html"),
    body: createElement("body"),
    getElementById(id) {
      return elements[id] || null;
    },
    querySelector() {
      return null;
    },
    createElement
  };

  const storage = createStorage(storageSeed);
  const sandbox = {
    window: {
      JLPT_VOCAB: LEVELS.map((level, index) => ({
        id: `n${5 - index}-0001`,
        level,
        kanji: ["山", "川", "海", "森", "空"][index],
        reading: ["やま", "かわ", "うみ", "もり", "そら"][index],
        meaning: `meaning-${level}`
      })),
      localStorage: storage,
      requestAnimationFrame(callback) {
        callback();
      },
      setTimeout(callback) {
        callback();
        return 1;
      },
      addEventListener() {},
      scrollTo() {},
      location: { protocol: "file:" },
      confirm() {
        return true;
      }
    },
    document,
    navigator: {},
    Date,
    Math,
    Set,
    JSON,
    Number,
    Boolean,
    RegExp,
    String,
    Array
  };
  Object.assign(sandbox.window, windowOverrides);
  sandbox.window.window = sandbox.window;

  vm.runInNewContext(fs.readFileSync("web/app.js", "utf8"), sandbox);
  return { elements, storage };
}

function buttonLabels(container) {
  return container.children.map((child) => child.textContent);
}

function activeLabels(container) {
  return container.children
    .filter((child) => child.className.split(/\s+/).includes("active"))
    .map((child) => child.textContent);
}

function click(button) {
  button.dispatch("click");
}

{
  const { elements, storage } = loadApp();
  assert.deepStrictEqual(buttonLabels(elements.levelToggles), LEVELS);
  assert.deepStrictEqual(activeLabels(elements.levelToggles), LEVELS);

  click(elements.levelToggles.children[0]);
  assert.deepStrictEqual(activeLabels(elements.levelToggles), ["N4", "N3", "N2", "N1"]);

  click(elements.levelToggles.children[4]);
  click(elements.levelToggles.children[3]);
  click(elements.levelToggles.children[2]);
  click(elements.levelToggles.children[1]);
  assert.deepStrictEqual(activeLabels(elements.levelToggles), ["N4"]);

  click(elements.levelToggles.children[1]);
  assert.deepStrictEqual(activeLabels(elements.levelToggles), ["N4"]);

  click(elements.levelToggles.children[0]);
  assert.deepStrictEqual(activeLabels(elements.levelToggles), ["N5", "N4"]);

  const settings = JSON.parse(storage.snapshot()["jlpt-kanji-cards.settings"]);
  assert.deepStrictEqual(settings.levels, ["N5", "N4"]);
}

{
  const { elements } = loadApp();
  assert.deepStrictEqual(buttonLabels(elements.mistakeLevelFilters), LEVELS);
  assert.deepStrictEqual(activeLabels(elements.mistakeLevelFilters), LEVELS);

  click(elements.mistakeLevelFilters.children[0]);
  assert.deepStrictEqual(activeLabels(elements.mistakeLevelFilters), ["N4", "N3", "N2", "N1"]);
  assert.match(elements.mistakeSummary.textContent, /^N4 N3 N2 N1 /);

  click(elements.mistakeLevelFilters.children[0]);
  assert.deepStrictEqual(activeLabels(elements.mistakeLevelFilters), LEVELS);
}

{
  const { elements, storage } = loadApp();
  elements.newRatioInput.value = "101";
  elements.dailyStudySizeInput.value = "0";
  elements.dailyStudySizeInput.dispatch("change");

  const settings = JSON.parse(storage.snapshot()["jlpt-kanji-cards.settings"]);
  assert.strictEqual(settings.newWordRatio, 100);
  assert.strictEqual(settings.sessionSize, 1);
  assert.strictEqual(elements.newRatioInput.value, "100");
  assert.strictEqual(elements.dailyStudySizeInput.value, "1");
}

{
  const { elements } = loadApp({}, {
    JLPT_VOCAB: [
      {
        id: "kana-only",
        level: "N5",
        kanji: "あさって",
        reading: "あさって",
        meaning: "모레"
      },
      {
        id: "compat-kanji-prefix",
        level: "N2",
        kanji: "-率",
        reading: "りつ",
        meaning: "-률"
      },
      {
        id: "compat-kanji-mixed",
        level: "N1",
        kanji: "率いる",
        reading: "ひきいる",
        meaning: "거느리다"
      },
      {
        id: "standard-kanji",
        level: "N1",
        kanji: "割当",
        reading: "わりあて",
        meaning: "할당"
      }
    ]
  });

  assert.strictEqual(elements.progressStat.textContent, "0/3");
}

{
  const { elements } = loadApp({}, {
    JLPT_VOCAB: [
      { id: "n1-0001", level: "N1", kanji: "世論", reading: "よろん", meaning: "여론" },
      { id: "n2-0002", level: "N2", kanji: "世論", reading: "せろん", meaning: "여론" }
    ]
  });

  assert.strictEqual(elements.progressStat.textContent, "0/1");
  assert.strictEqual(elements.levelBadge.textContent, "JLPT N1/N2");
  assert.strictEqual(elements.wordCard.listeners.pointerdown, undefined);
  assert.strictEqual(elements.wordCard.listeners.pointermove, undefined);
  assert.strictEqual(elements.wordCard.listeners.pointerup, undefined);
  click(elements.unknownButton);
  assert.strictEqual(elements.answerReading.textContent, "世論 · よろん / せろん");
  assert.strictEqual(elements.answerMeaning.textContent, "여론");
  click(elements.wordCard);
  assert.strictEqual(elements.answerPanel.hidden, true);
}

{
  const { elements } = loadApp({}, {
    JLPT_VOCAB: [
      { id: "n5-0001", level: "N5", kanji: "今日", reading: "きょう", meaning: "오늘" },
      { id: "n2-0001", level: "N2", kanji: "今日", reading: "こんにち", meaning: "오늘날. 요즘" }
    ]
  });

  assert.strictEqual(elements.progressStat.textContent, "0/2");
}

{
  const progressKey = "jlpt-kanji-cards.progress";
  const { elements, storage } = loadApp({
    [progressKey]: JSON.stringify({
      words: {
        "n1-0001": {
          seenCount: 2,
          correctCount: 1,
          wrongCount: 1,
          correctStreak: 0,
          totalThinkMs: 4000,
          avgThinkMs: 2000,
          lastThinkMs: 2500,
          lastSeenAt: 100,
          lastResult: "unknown"
        },
        "n1-0002": {
          seenCount: 3,
          correctCount: 3,
          wrongCount: 0,
          correctStreak: 3,
          totalThinkMs: 3000,
          avgThinkMs: 1000,
          lastThinkMs: 900,
          lastSeenAt: 200,
          lastResult: "known"
        }
      },
      history: [{ id: "n1-0002", result: "known", elapsed: 900, at: 200 }]
    })
  }, {
    JLPT_VOCAB: [
      { id: "n1-0001", level: "N1", kanji: "世論", reading: "よろん", meaning: "여론" },
      { id: "n1-0002", level: "N1", kanji: "世論", reading: "せろん", meaning: "여론" }
    ]
  });

  click(elements.mistakeTabButton);
  assert.strictEqual(elements.mistakeList.children.length, 1);
  assert.strictEqual(
    elements.mistakeList.children[0].children[1].children[2].textContent,
    "제시 5회 · 오답 1회 · 정답 4회"
  );

  const preserved = JSON.parse(storage.snapshot()[progressKey]);
  assert.deepStrictEqual(Object.keys(preserved.words), ["n1-0001", "n1-0002"]);
  assert.strictEqual(preserved.history[0].id, "n1-0002");

  click(elements.studyTabButton);
  click(elements.unknownButton);
  const updated = JSON.parse(storage.snapshot()[progressKey]);
  assert.strictEqual(updated.words["n1-0001"].seenCount, 3);
  assert.strictEqual(updated.words["n1-0001"].wrongCount, 2);
  assert.strictEqual(updated.words["n1-0002"].seenCount, 3);
  assert.strictEqual(updated.words["n1-0002"].wrongCount, 0);
  assert.match(elements.answerStats.textContent, /누적 오답 2회$/);
}

{
  const { elements, storage } = loadApp({}, { JLPT_REQUIRE_GOOGLE_SIGN_IN: true });
  assert.strictEqual(elements.choiceButtons.hidden, true);
  assert.strictEqual(elements.progressStat.textContent, "0/0");
  assert.match(elements.authStatus.textContent, /Auth error/);
  assert.match(elements.syncStatus.textContent, /Firebase config/);
  assert.strictEqual(storage.snapshot()["jlpt-kanji-cards.settings"], undefined);
}

{
  const htmlSource = fs.readFileSync("web/index.html", "utf8");
  const appSource = fs.readFileSync("web/app.js", "utf8");
  const styleSource = fs.readFileSync("web/styles.css", "utf8");

  assert.doesNotMatch(htmlSource, /평균 고민|thinkStat/);
  assert.doesNotMatch(appSource, /평균 고민|thinkStat/);
  assert.doesNotMatch(htmlSource, /swipe-mark/);
  assert.doesNotMatch(appSource, /pointer(?:down|move|up|cancel)|handlePointer|setCardTransform|swipeMark/);
  assert.doesNotMatch(styleSource, /swipe-mark|touch-action:\s*none|word-card\.dragging/);
  assert.match(appSource, /stats\.avgThinkMs = Math\.round/);
  assert.match(appSource, /slowPressure = Math\.min\(5, \(stats\.avgThinkMs \|\| 0\) \/ 2600\)/);
}

{
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync("web/data/vocab.js", "utf8"), sandbox);
  const wordsByKanji = new Map(sandbox.window.JLPT_VOCAB.map((word) => [word.kanji, word]));
  const weekdays = [
    ["月曜日", "げつようび", "월요일"],
    ["火曜日", "かようび", "화요일"],
    ["水曜日", "すいようび", "수요일"],
    ["木曜日", "もくようび", "목요일"],
    ["金曜日", "きんようび", "금요일"],
    ["土曜日", "どようび", "토요일"],
    ["日曜日", "にちようび", "일요일"]
  ];

  for (const [kanji, reading, meaning] of weekdays) {
    const word = wordsByKanji.get(kanji);
    assert.ok(word, `missing weekday: ${kanji}`);
    assert.strictEqual(word.reading, reading);
    assert.strictEqual(word.meaning, meaning);
  }
}

{
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync("web/data/vocab.js", "utf8"), sandbox);
  const groups = new Map();

  for (const word of sandbox.window.JLPT_VOCAB) {
    const key = [word.surface || word.kanji, word.kanji, word.meaning, word.pos || ""].join("\u0000");
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(word);
  }

  const mergedReadings = Array.from(groups.values())
    .filter((words) => words.length > 1)
    .map((words) => `${words[0].surface || words[0].kanji}:${words.map((word) => word.reading).join("/")}`)
    .sort();

  assert.deepStrictEqual(mergedReadings, [
    "世論:よろん/せろん",
    "夜:よる/よ",
    "擦る:こする/する",
    "重複:じゅうふく/ちょうふく"
  ].sort());
}

console.log("app regression tests passed");
