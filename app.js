(function () {
  const LEVELS = ["N5", "N4", "N3", "N2", "N1"];
  const SETTINGS_KEY = "jlpt-kanji-cards.settings";
  const PROGRESS_KEY = "jlpt-kanji-cards.progress";
  const DAY_MS = 24 * 60 * 60 * 1000;
  const KANJI_ONLY = /^[\u3400-\u9fff々]+$/u;

  const els = {
    deckSummary: document.getElementById("deckSummary"),
    accountPanel: document.getElementById("accountPanel"),
    authStatus: document.getElementById("authStatus"),
    syncStatus: document.getElementById("syncStatus"),
    signInButton: document.getElementById("signInButton"),
    signOutButton: document.getElementById("signOutButton"),
    studyTabButton: document.getElementById("studyTabButton"),
    mistakeTabButton: document.getElementById("mistakeTabButton"),
    settingsTabButton: document.getElementById("settingsTabButton"),
    studyPanel: document.getElementById("studyPanel"),
    mistakePanel: document.getElementById("mistakePanel"),
    settingsPanel: document.getElementById("settingsPanel"),
    mistakeSummary: document.getElementById("mistakeSummary"),
    mistakeLevelFilters: document.getElementById("mistakeLevelFilters"),
    mistakeList: document.getElementById("mistakeList"),
    levelToggles: document.getElementById("levelToggles"),
    newRatioSlider: document.getElementById("newRatioSlider"),
    newRatioInput: document.getElementById("newRatioInput"),
    dailyStudySizeInput: document.getElementById("dailyStudySizeInput"),
    resetProgressButton: document.getElementById("resetProgressButton"),
    sessionProgressBar: document.getElementById("sessionProgressBar"),
    cardStage: document.getElementById("cardStage"),
    wordCard: document.getElementById("wordCard"),
    kanjiText: document.getElementById("kanjiText"),
    levelBadge: document.getElementById("levelBadge"),
    swipeMarkLeft: document.querySelector(".swipe-mark-left"),
    swipeMarkRight: document.querySelector(".swipe-mark-right"),
    answerPanel: document.getElementById("answerPanel"),
    answerReading: document.getElementById("answerReading"),
    answerMeaning: document.getElementById("answerMeaning"),
    answerStats: document.getElementById("answerStats"),
    nextButton: document.getElementById("nextButton"),
    studyNewSessionButton: document.getElementById("studyNewSessionButton"),
    choiceButtons: document.getElementById("choiceButtons"),
    unknownButton: document.getElementById("unknownButton"),
    knownButton: document.getElementById("knownButton"),
    progressStat: document.getElementById("progressStat"),
    knownStat: document.getElementById("knownStat"),
    unknownStat: document.getElementById("unknownStat"),
    thinkStat: document.getElementById("thinkStat")
  };

  const defaultSettings = {
    levels: LEVELS.slice(),
    newWordRatio: 60,
    sessionSize: 20
  };

  const vocab = (window.JLPT_VOCAB || []).filter((word) => KANJI_ONLY.test(word.kanji));
  let settings = normalizeSettings(readStorage(SETTINGS_KEY, defaultSettings));
  let progress = normalizeProgress(readStorage(PROGRESS_KEY, { words: {}, history: [] }));
  let session = createEmptySession();
  let drag = null;
  let activeTab = "study";
  let mistakeLevels = LEVELS.slice();
  const firebaseConfig = window.JLPT_FIREBASE_CONFIG || null;
  const authRequired = Boolean(window.JLPT_REQUIRE_GOOGLE_SIGN_IN || firebaseConfig);
  const firebaseSdkBase = window.JLPT_FIREBASE_SDK_BASE || "https://www.gstatic.com/firebasejs/10.12.5";
  const authState = {
    required: authRequired,
    configured: Boolean(firebaseConfig),
    loading: authRequired,
    ready: !authRequired,
    user: null,
    error: "",
    syncStatus: authRequired ? "Checking sign-in" : "Local progress only",
    signIn: null,
    signOut: null,
    remoteStore: null
  };

  function readStorage(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeStorage(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      // Storage may be disabled in some embedded WebViews. The app still works for the current session.
    }
  }

  function clampNumber(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return min;
    }
    return Math.min(max, Math.max(min, Math.round(number)));
  }

  function normalizeSettings(value) {
    const selected = Array.isArray(value.levels)
      ? value.levels.filter((level) => LEVELS.includes(level))
      : LEVELS.slice();
    const sessionSize = clampNumber(value.sessionSize, 1, 80);
    const legacyNewCount = Number(value.newCount);
    const storedRatio = Number(value.newWordRatio);
    const migratedRatio = Number.isFinite(legacyNewCount)
      ? Math.round((legacyNewCount / sessionSize) * 100)
      : defaultSettings.newWordRatio;

    return {
      levels: selected.length ? selected : LEVELS.slice(),
      newWordRatio: clampNumber(Number.isFinite(storedRatio) ? storedRatio : migratedRatio, 0, 100),
      sessionSize
    };
  }

  function normalizeProgress(value) {
    return {
      words: value && typeof value.words === "object" && value.words ? value.words : {},
      history: Array.isArray(value && value.history) ? value.history : []
    };
  }

  function createEmptySession() {
    return {
      queue: [],
      index: 0,
      known: 0,
      unknown: 0,
      totalThinkMs: 0,
      startedAt: Date.now(),
      currentStartedAt: 0,
      currentThinkMs: 0,
      answerRevealedAt: 0,
      pendingKnownConfirmation: false,
      awaitingManualNext: false,
      revealed: false,
      recorded: false,
      targetTotal: 0,
      wrongRecordedIds: new Set()
    };
  }

  function canUseStudyData() {
    return !authState.required || (authState.ready && authState.user);
  }

  function setSyncStatus(status) {
    authState.syncStatus = status;
    renderAuthPanel();
  }

  function timestampToMillis(value) {
    if (typeof value === "number") {
      return value;
    }
    if (value && typeof value.toMillis === "function") {
      return value.toMillis();
    }
    return 0;
  }

  function copyStats(stats) {
    return {
      seenCount: stats.seenCount || 0,
      correctCount: stats.correctCount || 0,
      wrongCount: stats.wrongCount || 0,
      correctStreak: stats.correctStreak || 0,
      totalThinkMs: stats.totalThinkMs || 0,
      avgThinkMs: stats.avgThinkMs || 0,
      lastThinkMs: stats.lastThinkMs || 0,
      lastSeenAt: timestampToMillis(stats.lastSeenAt),
      lastResult: stats.lastResult || ""
    };
  }

  async function loadFirebaseModules() {
    if (window.JLPT_FIREBASE_MODULES) {
      return window.JLPT_FIREBASE_MODULES;
    }

    const [app, auth, firestore] = await Promise.all([
      import(`${firebaseSdkBase}/firebase-app.js`),
      import(`${firebaseSdkBase}/firebase-auth.js`),
      import(`${firebaseSdkBase}/firebase-firestore.js`)
    ]);

    return { ...app, ...auth, ...firestore };
  }

  function createFirestoreProgressStore(modules, db, uid) {
    const {
      collection,
      deleteDoc,
      doc,
      getDoc,
      getDocs,
      serverTimestamp,
      setDoc,
      writeBatch
    } = modules;

    function userDoc() {
      return doc(db, "users", uid);
    }

    function settingsDoc() {
      return doc(db, "users", uid, "settings", "current");
    }

    function wordStatsDoc(wordId) {
      return doc(db, "users", uid, "wordStats", wordId);
    }

    function historyCollection() {
      return collection(db, "users", uid, "history");
    }

    async function commitDeletes(docs) {
      const chunkSize = 10;
      for (let index = 0; index < docs.length; index += chunkSize) {
        const batch = writeBatch(db);
        docs.slice(index, index + chunkSize).forEach((snapshot) => batch.delete(snapshot.ref));
        await batch.commit();
      }
    }

    return {
      async load() {
        await setDoc(userDoc(), {
          updatedAt: serverTimestamp(),
          localImportSupported: false
        }, { merge: true });

        const [settingsSnapshot, statsSnapshot] = await Promise.all([
          getDoc(settingsDoc()),
          getDocs(collection(db, "users", uid, "wordStats"))
        ]);
        const remoteSettings = settingsSnapshot.exists() ? settingsSnapshot.data() : settings;
        const words = {};
        statsSnapshot.forEach((snapshot) => {
          words[snapshot.id] = copyStats(snapshot.data());
        });

        return {
          settings: normalizeSettings(remoteSettings || defaultSettings),
          progress: normalizeProgress({ words, history: [] })
        };
      },

      async saveSettings(nextSettings) {
        await setDoc(settingsDoc(), {
          levels: nextSettings.levels,
          newWordRatio: nextSettings.newWordRatio,
          sessionSize: nextSettings.sessionSize,
          updatedAt: serverTimestamp()
        }, { merge: false });
      },

      async recordAnswer(answer) {
        const now = serverTimestamp();
        await Promise.all([
          setDoc(wordStatsDoc(answer.wordId), {
            ...copyStats(answer.stats),
            lastSeenAt: now,
            updatedAt: now
          }, { merge: false }),
          setDoc(doc(historyCollection()), {
            wordId: answer.wordId,
            result: answer.result,
            elapsed: answer.elapsed,
            at: now
          }, { merge: false })
        ]);
      },

      async reset(nextSettings) {
        const [statsSnapshot, historySnapshot] = await Promise.all([
          getDocs(collection(db, "users", uid, "wordStats")),
          getDocs(historyCollection())
        ]);
        await commitDeletes([...statsSnapshot.docs, ...historySnapshot.docs]);
        await this.saveSettings(nextSettings);
      }
    };
  }

  function queueRemoteTask(task, savingLabel) {
    if (!authState.remoteStore || !authState.user) {
      return;
    }

    setSyncStatus(savingLabel || "Syncing");
    Promise.resolve()
      .then(task)
      .then(() => setSyncStatus("Synced"))
      .catch((error) => {
        authState.error = error && error.message ? error.message : "Sync failed";
        setSyncStatus("Sync failed");
      });
  }

  function queueRemoteAnswer(answer) {
    queueRemoteTask(() => authState.remoteStore.recordAnswer(answer), "Saving progress");
  }

  async function initializeFirebaseRuntime() {
    if (!authState.required) {
      startSession();
      return;
    }

    if (!authState.configured) {
      authState.loading = false;
      authState.error = "Firebase config is missing";
      authState.syncStatus = "Add web/firebase-config.js values";
      render();
      return;
    }

    try {
      const modules = await loadFirebaseModules();
      const app = modules.initializeApp(firebaseConfig);
      const auth = modules.getAuth(app);
      const db = modules.getFirestore(app);
      const provider = new modules.GoogleAuthProvider();
      const emulators = window.JLPT_FIREBASE_EMULATORS || {};

      if (emulators.auth && modules.connectAuthEmulator) {
        modules.connectAuthEmulator(auth, emulators.auth, { disableWarnings: true });
      }
      if (emulators.firestore && modules.connectFirestoreEmulator) {
        modules.connectFirestoreEmulator(db, emulators.firestore.host, emulators.firestore.port);
      }

      authState.signIn = () => modules.signInWithPopup(auth, provider);
      authState.signOut = () => modules.signOut(auth);
      modules.onAuthStateChanged(auth, async (user) => {
        authState.user = user || null;
        authState.ready = false;
        authState.loading = Boolean(user);
        authState.error = "";
        authState.remoteStore = null;
        session = createEmptySession();
        render();

        if (!user) {
          authState.loading = false;
          authState.syncStatus = "Sign in required";
          render();
          return;
        }

        try {
          setSyncStatus("Loading progress");
          const store = createFirestoreProgressStore(modules, db, user.uid);
          const remoteState = await store.load();
          settings = normalizeSettings(remoteState.settings);
          progress = normalizeProgress(remoteState.progress);
          authState.remoteStore = store;
          authState.ready = true;
          authState.loading = false;
          authState.syncStatus = "Synced";
          startSession();
        } catch (error) {
          authState.loading = false;
          authState.ready = false;
          authState.error = error && error.message ? error.message : "Unable to load progress";
          authState.syncStatus = "Progress load failed";
          render();
        }
      });
    } catch (error) {
      authState.loading = false;
      authState.ready = false;
      authState.error = error && error.message ? error.message : "Firebase failed to initialize";
      authState.syncStatus = "Firebase unavailable";
      render();
    }
  }

  function saveSettings() {
    settings = normalizeSettings(settings);
    if (authState.remoteStore && authState.ready) {
      queueRemoteTask(() => authState.remoteStore.saveSettings(settings), "Saving settings");
      return;
    }

    writeStorage(SETTINGS_KEY, settings);
  }

  function saveProgress() {
    if (authState.remoteStore && authState.ready) {
      return;
    }

    writeStorage(PROGRESS_KEY, progress);
  }

  function isPlainSuruVerb(word) {
    return word.pos === "동사" && word.surface === `${word.kanji}する`;
  }

  function selectedPool() {
    return vocab.filter((word) => settings.levels.includes(word.level) && !isPlainSuruVerb(word));
  }

  function shuffle(items) {
    const result = items.slice();
    for (let index = result.length - 1; index > 0; index -= 1) {
      const target = Math.floor(Math.random() * (index + 1));
      const value = result[index];
      result[index] = result[target];
      result[target] = value;
    }
    return result;
  }

  function statsWrongRate(stats) {
    const seenCount = Math.max(0, stats.seenCount || 0);
    if (!seenCount) {
      return 0;
    }

    return Math.max(0, stats.wrongCount || 0) / seenCount;
  }

  function reviewScore(word, now) {
    const stats = progress.words[word.id];
    if (!stats || !stats.seenCount) {
      return 0;
    }

    const daysSinceSeen = Math.max(0, (now - (stats.lastSeenAt || now)) / DAY_MS);
    const wrongRatePressure = statsWrongRate(stats) * 8;
    const wrongVolumePressure = Math.min(4, Math.log1p(stats.wrongCount || 0));
    const slowPressure = Math.min(5, (stats.avgThinkMs || 0) / 2600);
    const recencyRecovery = Math.min(4, daysSinceSeen * 1.2);
    const lastWrongBoost = stats.lastResult === "unknown" ? 5 : 0;
    const streakRelief = Math.min(5, (stats.correctStreak || 0) * 1.15);
    const veryRecentKnownPenalty = daysSinceSeen < 1 / 24 && stats.lastResult === "known" ? 0.28 : 1;
    const score = 1 + wrongRatePressure + wrongVolumePressure + slowPressure + recencyRecovery + lastWrongBoost - streakRelief;

    return Math.max(0.12, score * veryRecentKnownPenalty);
  }

  function weightedSample(words, count) {
    const now = Date.now();
    const candidates = words.map((word) => ({ word, score: reviewScore(word, now) }));
    const picked = [];

    while (picked.length < count && candidates.length) {
      const total = candidates.reduce((sum, candidate) => sum + candidate.score, 0);
      let marker = Math.random() * total;
      let selectedIndex = 0;

      for (let index = 0; index < candidates.length; index += 1) {
        marker -= candidates[index].score;
        if (marker <= 0) {
          selectedIndex = index;
          break;
        }
      }

      const selected = candidates.splice(selectedIndex, 1)[0];
      picked.push(selected.word);
    }

    return picked;
  }

  function buildSessionQueue() {
    const pool = selectedPool();
    const unseen = shuffle(pool.filter((word) => !progress.words[word.id] || !progress.words[word.id].seenCount));
    const seen = pool.filter((word) => progress.words[word.id] && progress.words[word.id].seenCount);
    const totalSlots = Math.min(settings.sessionSize, pool.length);
    const reviewTarget = Math.round(totalSlots * (1 - settings.newWordRatio / 100));
    const preferredReviewSlots = Math.min(seen.length, reviewTarget);
    const newSlots = Math.max(0, totalSlots - preferredReviewSlots);
    const newWords = unseen.slice(0, newSlots);
    const reviewSlots = Math.min(seen.length, totalSlots - newWords.length);
    const reviewWords = weightedSample(seen, reviewSlots);

    return shuffle([
      ...newWords.map((word) => ({ word, kind: "new" })),
      ...reviewWords.map((word) => ({ word, kind: "review" }))
    ]);
  }

  function startSession() {
    if (!canUseStudyData()) {
      session = createEmptySession();
      render();
      return;
    }

    saveSettings();
    session = createEmptySession();
    session.queue = buildSessionQueue();
    session.targetTotal = session.queue.length;
    render();
  }

  function currentItem() {
    return session.queue[session.index] || null;
  }

  function shouldShowSurfaceOnFront(word) {
    return Boolean(word.surface);
  }

  function frontTextFor(word) {
    if (shouldShowSurfaceOnFront(word) && word.surface) {
      return word.surface;
    }

    return word.kanji;
  }

  function startCurrentCardTimer() {
    session.currentStartedAt = Date.now();
    session.currentThinkMs = 0;
    session.answerRevealedAt = 0;
    session.pendingKnownConfirmation = false;
    session.awaitingManualNext = false;
    session.revealed = false;
    session.recorded = false;
  }

  function seconds(ms) {
    return `${(ms / 1000).toFixed(1)}초`;
  }

  function percent(value) {
    return `${Math.round(value * 100)}%`;
  }

  function getWordStats(wordId) {
    if (!progress.words[wordId]) {
      progress.words[wordId] = {
        seenCount: 0,
        correctCount: 0,
        wrongCount: 0,
        correctStreak: 0,
        totalThinkMs: 0,
        avgThinkMs: 0,
        lastThinkMs: 0,
        lastSeenAt: 0,
        lastResult: ""
      };
    }

    return progress.words[wordId];
  }

  function recordAnswer(result) {
    const item = currentItem();
    if (!item || session.recorded || !session.revealed) {
      return null;
    }

    const now = Date.now();
    const elapsed = Math.max(250, session.currentThinkMs || now - session.currentStartedAt);
    const stats = getWordStats(item.word.id);
    const wasWrongThisSession = session.wrongRecordedIds.has(item.word.id);
    let remoteAnswer = null;

    if (result === "known") {
      if (!wasWrongThisSession) {
        stats.seenCount += 1;
        stats.correctCount += 1;
        stats.correctStreak = (stats.correctStreak || 0) + 1;
        stats.lastThinkMs = elapsed;
        stats.lastSeenAt = now;
        stats.lastResult = result;
        stats.totalThinkMs = (stats.totalThinkMs || 0) + elapsed;
        stats.avgThinkMs = Math.round(stats.totalThinkMs / stats.seenCount);
      }
      session.known += 1;
      session.totalThinkMs += elapsed;
      if (!wasWrongThisSession) {
        progress.history.unshift({
          id: item.word.id,
          result,
          elapsed,
          at: now
        });
        remoteAnswer = {
          wordId: item.word.id,
          result,
          elapsed,
          stats: copyStats(stats)
        };
      }
    } else {
      const shouldRecordWrong = !session.wrongRecordedIds.has(item.word.id);
      if (shouldRecordWrong) {
        session.wrongRecordedIds.add(item.word.id);
        stats.seenCount += 1;
        stats.lastThinkMs = elapsed;
        stats.lastSeenAt = now;
        stats.totalThinkMs = (stats.totalThinkMs || 0) + elapsed;
        stats.avgThinkMs = Math.round(stats.totalThinkMs / stats.seenCount);
        stats.lastResult = result;
        stats.wrongCount += 1;
        stats.correctStreak = 0;
        session.unknown += 1;
        progress.history.unshift({
          id: item.word.id,
          result,
          elapsed,
          at: now
        });
        remoteAnswer = {
          wordId: item.word.id,
          result,
          elapsed,
          stats: copyStats(stats)
        };
      }
      session.queue.push({ word: item.word, kind: item.kind });
    }

    session.recorded = true;
    progress.history = progress.history.slice(0, 200);
    saveProgress();
    if (remoteAnswer) {
      queueRemoteAnswer(remoteAnswer);
    }

    return { elapsed, stats };
  }

  function setCardTransform(offsetX) {
    const capped = Math.max(-180, Math.min(180, offsetX));
    const rotation = capped / 18;
    els.wordCard.style.transform = `translateX(${capped}px) rotate(${rotation}deg)`;
    els.wordCard.classList.toggle("known-glow", capped > 42);
    els.wordCard.classList.toggle("unknown-glow", capped < -42);
  }

  function resetCardTransform() {
    els.wordCard.style.transform = "translateX(0) rotate(0deg)";
    els.wordCard.classList.remove("dragging", "known-glow", "unknown-glow");
  }

  function answerKnown() {
    if (!session.revealed) {
      revealAnswer("known");
      return;
    }

    const result = recordAnswer("known");
    if (!result) {
      return;
    }

    resetCardTransform();
    session.awaitingManualNext = false;
    showAnswer(result);
    els.wordCard.classList.add("known-glow");
    renderChoiceState();
    renderStats();
    window.setTimeout(nextCard, 160);
  }

  function answerUnknown() {
    if (!session.revealed) {
      revealAndRecordUnknown();
      return;
    }

    const result = recordAnswer("unknown");
    if (!result) {
      return;
    }

    resetCardTransform();
    els.wordCard.classList.add("unknown-glow");
    session.awaitingManualNext = false;
    showAnswer(result);
    renderChoiceState();
    renderStats();
    window.setTimeout(nextCard, 160);
  }

  function revealAnswer(mode) {
    const item = currentItem();
    if (!item || session.revealed || session.recorded) {
      return;
    }

    session.revealed = true;
    session.pendingKnownConfirmation = mode === "known";
    session.awaitingManualNext = false;
    session.answerRevealedAt = Date.now();
    session.currentThinkMs = Math.max(250, session.answerRevealedAt - session.currentStartedAt);
    resetCardTransform();
    showAnswer(null);
    renderChoiceState();
  }

  function revealAndRecordUnknown() {
    revealAnswer("unknown");
    const result = recordAnswer("unknown");
    if (!result) {
      return;
    }

    resetCardTransform();
    els.wordCard.classList.add("unknown-glow");
    session.awaitingManualNext = true;
    showAnswer(result);
    renderChoiceState();
    renderStats();
  }

  function showAnswer(result) {
    const item = currentItem();
    if (!item) {
      return;
    }

    const surface = item.word.surface || item.word.kanji;
    const part = item.word.pos ? `${item.word.pos} · ` : "";
    const stats = progress.words[item.word.id];
    const wrongCount = result ? result.stats.wrongCount : (stats && stats.wrongCount) || 0;
    const elapsed = result ? result.elapsed : session.currentThinkMs;
    els.answerReading.textContent = `${surface} · ${item.word.reading}`;
    els.answerMeaning.textContent = item.word.meaning;
    els.answerStats.textContent = `${part}고민 ${seconds(elapsed)} · 누적 오답 ${wrongCount}회`;
    resetAnswerTextFit();
    els.answerPanel.hidden = false;
    fitAnswerText();
  }

  function nextCard() {
    session.index += 1;
    render();
  }

  function resetAnswerTextFit() {
    [
      "--answer-panel-pad",
      "--answer-reading-size",
      "--answer-meaning-size",
      "--answer-stats-size",
      "--answer-meaning-gap",
      "--answer-stats-gap"
    ].forEach((property) => els.answerPanel.style.removeProperty(property));
  }

  function setAnswerTextScale(scale) {
    els.answerPanel.style.setProperty("--answer-panel-pad", `${Math.max(8, Math.round(16 * scale))}px`);
    els.answerPanel.style.setProperty("--answer-reading-size", `${Math.max(14, Math.round(24 * scale))}px`);
    els.answerPanel.style.setProperty("--answer-meaning-size", `${Math.max(12, Math.round(18 * scale))}px`);
    els.answerPanel.style.setProperty("--answer-stats-size", `${Math.max(10, Math.round(13 * scale))}px`);
    els.answerPanel.style.setProperty("--answer-meaning-gap", `${Math.max(2, Math.round(6 * scale))}px`);
    els.answerPanel.style.setProperty("--answer-stats-gap", `${Math.max(3, Math.round(10 * scale))}px`);
  }

  function answerTextOverflows() {
    const panelOverflow = els.answerPanel.scrollHeight > els.answerPanel.clientHeight + 1;
    const childOverflow = [els.answerReading, els.answerMeaning, els.answerStats].some(
      (element) => element.scrollWidth > element.clientWidth + 1
    );
    return panelOverflow || childOverflow;
  }

  function fitAnswerText() {
    window.requestAnimationFrame(() => {
      if (els.answerPanel.hidden) {
        return;
      }

      let scale = 1;
      setAnswerTextScale(scale);

      while (scale > 0.55 && answerTextOverflows()) {
        scale = Math.max(0.55, scale - 0.05);
        setAnswerTextScale(scale);
      }
    });
  }

  function fitKanjiText() {
    const item = currentItem();
    const baseSize = item ? 84 : 64;
    const minSize = item ? 42 : 40;
    const maxWidth = Math.max(140, els.wordCard.clientWidth - 48);

    els.kanjiText.style.whiteSpace = "nowrap";
    els.kanjiText.style.fontSize = `${baseSize}px`;

    window.requestAnimationFrame(() => {
      let size = baseSize;
      while (size > minSize && els.kanjiText.scrollWidth > maxWidth) {
        size -= 2;
        els.kanjiText.style.fontSize = `${size}px`;
      }

      if (els.kanjiText.scrollWidth > maxWidth) {
        els.kanjiText.style.whiteSpace = "normal";
        els.kanjiText.style.fontSize = `${minSize}px`;
      }
    });
  }

  function nextSelectedLevels(selectedLevels, level) {
    if (selectedLevels.includes(level)) {
      if (selectedLevels.length === 1) {
        return selectedLevels;
      }
      return selectedLevels.filter((item) => item !== level);
    }

    return LEVELS.filter((item) => item === level || selectedLevels.includes(item));
  }

  function renderLevelSegments(container, selectedLevels, onChange) {
    container.innerHTML = "";
    LEVELS.forEach((level) => {
      const active = selectedLevels.includes(level);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `segment-button${active ? " active" : ""}`;
      button.textContent = level;
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.addEventListener("click", () => onChange(level));
      container.appendChild(button);
    });
  }

  function renderLevelToggles() {
    renderLevelSegments(els.levelToggles, settings.levels, (level) => {
      const nextLevels = nextSelectedLevels(settings.levels, level);
      if (nextLevels === settings.levels) {
        return;
      }

      settings.levels = nextLevels;
      saveSettings();
      renderLevelToggles();
      startSession();
    });
  }

  function renderMistakeLevelFilters() {
    renderLevelSegments(els.mistakeLevelFilters, mistakeLevels, (level) => {
      const nextLevels = nextSelectedLevels(mistakeLevels, level);
      if (nextLevels === mistakeLevels) {
        return;
      }

      mistakeLevels = nextLevels;
      renderMistakeLevelFilters();
      renderMistakeList();
    });
  }

  function renderAuthPanel() {
    if (!els.authStatus || !els.signInButton || !els.signOutButton || !els.syncStatus) {
      return;
    }

    els.signInButton.hidden = true;
    els.signOutButton.hidden = true;

    if (!authState.required) {
      els.authStatus.textContent = "Local mode";
      els.syncStatus.textContent = authState.syncStatus || "Local progress only";
      return;
    }

    if (authState.error) {
      els.authStatus.textContent = "Auth error";
      els.syncStatus.textContent = authState.error;
      els.signInButton.hidden = !authState.configured;
      return;
    }

    if (authState.loading) {
      els.authStatus.textContent = "Checking account";
      els.syncStatus.textContent = authState.syncStatus || "Loading";
      return;
    }

    if (!authState.user) {
      els.authStatus.textContent = "Google sign-in required";
      els.syncStatus.textContent = authState.syncStatus || "Sign in to study";
      els.signInButton.hidden = false;
      return;
    }

    els.authStatus.textContent = authState.user.email || authState.user.displayName || "Signed in";
    els.syncStatus.textContent = authState.syncStatus || "Synced";
    els.signOutButton.hidden = false;
  }

  function renderDeckSummary() {
    if (!canUseStudyData()) {
      els.deckSummary.textContent = authState.error ? "Complete Firebase setup to enable login" : "Sign in with Google to load progress";
      return;
    }

    const pool = selectedPool();
    const learned = pool.filter((word) => progress.words[word.id] && progress.words[word.id].seenCount).length;
    const wrong = pool.reduce((sum, word) => sum + ((progress.words[word.id] && progress.words[word.id].wrongCount) || 0), 0);
    els.deckSummary.textContent = `${settings.levels.join(" ")} · ${pool.length}개 · 학습 ${learned}개 · 오답 ${wrong}회`;
  }

  function wrongRate(stats) {
    return statsWrongRate(stats);
  }

  function seenWordRecords() {
    return vocab
      .map((word) => ({ word, stats: progress.words[word.id] }))
      .filter((record) => mistakeLevels.includes(record.word.level) && record.stats && record.stats.seenCount)
      .sort((left, right) => {
        const rateDelta = wrongRate(right.stats) - wrongRate(left.stats);
        if (rateDelta) {
          return rateDelta;
        }

        const wrongDelta = (right.stats.wrongCount || 0) - (left.stats.wrongCount || 0);
        if (wrongDelta) {
          return wrongDelta;
        }

        const thinkDelta = (right.stats.avgThinkMs || 0) - (left.stats.avgThinkMs || 0);
        if (thinkDelta) {
          return thinkDelta;
        }

        return (right.stats.lastSeenAt || 0) - (left.stats.lastSeenAt || 0);
      });
  }

  function appendMistakeRecord(record, index) {
    const { word, stats } = record;
    const seenCount = stats.seenCount || 0;
    const wrongCount = stats.wrongCount || 0;
    const correctCount = stats.correctCount || 0;
    const item = document.createElement("article");
    item.className = "mistake-item";

    const rank = document.createElement("div");
    rank.className = "mistake-rank";
    rank.textContent = String(index + 1);

    const body = document.createElement("div");
    body.className = "mistake-body";

    const term = document.createElement("div");
    term.className = "mistake-term";
    term.textContent = frontTextFor(word);

    const detail = document.createElement("div");
    detail.className = "mistake-detail";
    detail.textContent = `${word.level}${word.pos ? ` · ${word.pos}` : ""} · ${word.reading} · ${word.meaning}`;

    const counts = document.createElement("div");
    counts.className = "mistake-counts";
    counts.textContent = `제시 ${seenCount}회 · 오답 ${wrongCount}회 · 정답 ${correctCount}회 · 평균 고민 ${seconds(stats.avgThinkMs || 0)}`;

    const rate = document.createElement("strong");
    rate.className = "mistake-rate";
    rate.textContent = percent(wrongRate(stats));

    body.append(term, detail, counts);
    item.append(rank, body, rate);
    els.mistakeList.appendChild(item);
  }

  function renderMistakeList() {
    const records = seenWordRecords();
    const totalSeen = records.reduce((sum, record) => sum + (record.stats.seenCount || 0), 0);
    const totalWrong = records.reduce((sum, record) => sum + (record.stats.wrongCount || 0), 0);
    const averageWrongRate = totalSeen ? totalWrong / totalSeen : 0;
    const levelText = mistakeLevels.join(" ");

    els.mistakeSummary.textContent = `${levelText} · 제시 단어 ${records.length}개 · 누적 제시 ${totalSeen}회 · 누적 오답 ${totalWrong}회 · 평균 오답률 ${percent(averageWrongRate)}`;
    els.mistakeList.innerHTML = "";

    if (!records.length) {
      const empty = document.createElement("div");
      empty.className = "mistake-empty";
      empty.textContent = "선택한 급수에서 아직 제시된 단어가 없습니다.";
      els.mistakeList.appendChild(empty);
      return;
    }

    records.forEach(appendMistakeRecord);
  }

  function renderTabs() {
    const studyActive = activeTab === "study";
    const mistakeActive = activeTab === "mistake";
    const settingsActive = activeTab === "settings";
    els.studyTabButton.classList.toggle("active", studyActive);
    els.mistakeTabButton.classList.toggle("active", mistakeActive);
    els.settingsTabButton.classList.toggle("active", settingsActive);
    els.studyTabButton.setAttribute("aria-selected", studyActive ? "true" : "false");
    els.mistakeTabButton.setAttribute("aria-selected", mistakeActive ? "true" : "false");
    els.settingsTabButton.setAttribute("aria-selected", settingsActive ? "true" : "false");
    els.studyPanel.hidden = !studyActive;
    els.mistakePanel.hidden = !mistakeActive;
    els.settingsPanel.hidden = !settingsActive;
    setScrollLock(studyActive || settingsActive);
  }

  function setScrollLock(locked) {
    if (locked) {
      window.scrollTo(0, 0);
    }
    document.documentElement.classList.toggle("scroll-locked", locked);
    document.body.classList.toggle("scroll-locked", locked);
  }

  function setActiveTab(tab) {
    activeTab = tab;
    renderTabs();

    if (activeTab === "mistake") {
      renderMistakeList();
      return;
    }

    if (activeTab === "study") {
      window.requestAnimationFrame(fitKanjiText);
    }
  }

  function renderCurrentCard() {
    if (!canUseStudyData()) {
      resetCardTransform();
      els.answerPanel.hidden = true;
      els.kanjiText.textContent = authState.error ? "Login setup needed" : "Google login required";
      els.kanjiText.classList.add("empty-state");
      els.levelBadge.hidden = true;
      els.choiceButtons.hidden = true;
      if (activeTab === "study") {
        fitKanjiText();
      }
      return;
    }

    const item = currentItem();
    resetCardTransform();
    els.answerPanel.hidden = true;
    renderChoiceState();

    if (!item) {
      els.kanjiText.textContent = session.queue.length ? "完了" : "空";
      els.kanjiText.classList.add("empty-state");
      els.levelBadge.hidden = true;
      if (activeTab === "study") {
        fitKanjiText();
      }
      return;
    }

    startCurrentCardTimer();
    els.kanjiText.classList.remove("empty-state");
    els.kanjiText.textContent = frontTextFor(item.word);
    els.levelBadge.textContent = `JLPT ${item.word.level}`;
    els.levelBadge.hidden = false;
    renderChoiceState();
    if (activeTab === "study") {
      fitKanjiText();
    }
  }

  function renderStats() {
    if (!canUseStudyData()) {
      els.progressStat.textContent = "0/0";
      els.knownStat.textContent = "0";
      els.unknownStat.textContent = "0";
      els.thinkStat.textContent = seconds(0);
      els.sessionProgressBar.style.width = "0%";
      return;
    }

    const total = session.targetTotal || session.queue.length;
    const completed = Math.min(session.known, total);
    const averageThink = completed ? session.totalThinkMs / completed : 0;

    els.progressStat.textContent = `${completed}/${total}`;
    els.knownStat.textContent = String(session.known);
    els.unknownStat.textContent = String(session.unknown);
    els.thinkStat.textContent = seconds(averageThink);
    els.sessionProgressBar.style.width = total ? `${(completed / total) * 100}%` : "0%";
  }

  function renderChoiceState() {
    const item = currentItem();
    els.choiceButtons.classList.remove("next-only", "session-complete");
    els.unknownButton.hidden = false;
    els.knownButton.hidden = false;
    els.nextButton.hidden = true;
    els.studyNewSessionButton.hidden = true;

    if (!item) {
      els.choiceButtons.hidden = false;
      els.choiceButtons.classList.add("session-complete");
      els.unknownButton.hidden = true;
      els.knownButton.hidden = true;
      els.nextButton.hidden = true;
      els.studyNewSessionButton.hidden = false;
      return;
    }

    els.choiceButtons.hidden = false;

    if (session.recorded) {
      if (session.awaitingManualNext) {
        els.choiceButtons.classList.add("next-only");
        els.unknownButton.hidden = true;
        els.knownButton.hidden = true;
        els.nextButton.hidden = false;
        els.studyNewSessionButton.hidden = true;
        els.nextButton.textContent = "다음 카드로";
        return;
      }

      els.choiceButtons.hidden = true;
      return;
    }

    if (session.revealed) {
      els.unknownButton.textContent = "← 틀림";
      els.knownButton.textContent = "맞음 →";
      els.swipeMarkLeft.textContent = "틀림";
      els.swipeMarkRight.textContent = "맞음";
      return;
    }

    els.unknownButton.textContent = "← 모르겠음";
    els.knownButton.textContent = "알고 있음 →";
    els.swipeMarkLeft.textContent = "정답 보기";
    els.swipeMarkRight.textContent = "정답 보기";
  }

  function renderInputs() {
    els.newRatioSlider.value = String(settings.newWordRatio);
    els.newRatioInput.value = String(settings.newWordRatio);
    els.dailyStudySizeInput.value = String(settings.sessionSize);
  }

  function render() {
    renderAuthPanel();
    renderTabs();
    renderInputs();
    renderLevelToggles();
    renderMistakeLevelFilters();
    renderDeckSummary();
    renderCurrentCard();
    renderStats();
    if (activeTab === "mistake") {
      renderMistakeList();
    }
  }

  function syncNumberSettings() {
    settings.newWordRatio = clampNumber(els.newRatioInput.value, 0, 100);
    settings.sessionSize = clampNumber(els.dailyStudySizeInput.value, 1, 80);
    saveSettings();
    renderInputs();
    startSession();
  }

  function syncRatioFromSlider() {
    const value = clampNumber(els.newRatioSlider.value, 0, 100);
    els.newRatioInput.value = String(value);
    syncNumberSettings();
  }

  function syncRatioFromInput() {
    const value = clampNumber(els.newRatioInput.value, 0, 100);
    els.newRatioInput.value = String(value);
    els.newRatioSlider.value = String(value);
    syncNumberSettings();
  }

  function handleCardTap() {
    if (!currentItem() || !session.revealed) {
      return;
    }

    if (session.recorded) {
      nextCard();
      return;
    }

    if (session.pendingKnownConfirmation) {
      answerKnown();
    }
  }

  function handlePointerDown(event) {
    if (!currentItem()) {
      return;
    }

    drag = {
      id: event.pointerId,
      startX: event.clientX,
      currentX: event.clientX
    };
    els.wordCard.setPointerCapture(event.pointerId);
    els.wordCard.classList.add("dragging");
  }

  function handlePointerMove(event) {
    if (!drag || drag.id !== event.pointerId) {
      return;
    }

    drag.currentX = event.clientX;
    setCardTransform(drag.currentX - drag.startX);
  }

  function handlePointerUp(event) {
    if (!drag || drag.id !== event.pointerId) {
      return;
    }

    const offset = drag.currentX - drag.startX;
    drag = null;
    els.wordCard.releasePointerCapture(event.pointerId);
    els.wordCard.classList.remove("dragging");

    if (session.recorded) {
      if (Math.abs(offset) < 24) {
        handleCardTap();
      } else {
        resetCardTransform();
      }
      return;
    }

    if (offset > 96) {
      answerKnown();
    } else if (offset < -96) {
      answerUnknown();
    } else if (Math.abs(offset) < 24) {
      handleCardTap();
    } else {
      resetCardTransform();
    }
  }

  async function resetProgress() {
    if (!window.confirm("학습 기록을 초기화합니다. 계속하시겠습니까?")) {
      return;
    }

    progress = { words: {}, history: [] };
    if (authState.remoteStore && authState.ready) {
      try {
        setSyncStatus("Resetting progress");
        await authState.remoteStore.reset(settings);
        setSyncStatus("Synced");
      } catch (error) {
        authState.error = error && error.message ? error.message : "Reset failed";
        setSyncStatus("Reset failed");
      }
    }

    saveProgress();
    startSession();
  }

  function bindEvents() {
    els.studyTabButton.addEventListener("click", () => setActiveTab("study"));
    els.mistakeTabButton.addEventListener("click", () => setActiveTab("mistake"));
    els.settingsTabButton.addEventListener("click", () => setActiveTab("settings"));
    els.signInButton.addEventListener("click", () => {
      if (authState.signIn) {
        authState.signIn().catch((error) => {
          authState.error = error && error.message ? error.message : "Sign-in failed";
          renderAuthPanel();
        });
      }
    });
    els.signOutButton.addEventListener("click", () => {
      if (authState.signOut) {
        authState.signOut().catch((error) => {
          authState.error = error && error.message ? error.message : "Sign-out failed";
          renderAuthPanel();
        });
      }
    });
    els.studyNewSessionButton.addEventListener("click", startSession);
    els.resetProgressButton.addEventListener("click", resetProgress);
    els.newRatioSlider.addEventListener("input", syncRatioFromSlider);
    els.newRatioInput.addEventListener("change", syncRatioFromInput);
    els.dailyStudySizeInput.addEventListener("change", syncNumberSettings);
    els.knownButton.addEventListener("click", answerKnown);
    els.unknownButton.addEventListener("click", answerUnknown);
    els.nextButton.addEventListener("click", nextCard);
    els.wordCard.addEventListener("pointerdown", handlePointerDown);
    els.wordCard.addEventListener("pointermove", handlePointerMove);
    els.wordCard.addEventListener("pointerup", handlePointerUp);
    els.wordCard.addEventListener("pointercancel", () => {
      drag = null;
      resetCardTransform();
    });
    els.wordCard.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight") {
        answerKnown();
      } else if (event.key === "ArrowLeft") {
        answerUnknown();
      } else if (event.key === "Enter") {
        handleCardTap();
      }
    });
    window.addEventListener("resize", () => {
      fitKanjiText();
      fitAnswerText();
    });
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || !/^https?:$/.test(window.location.protocol)) {
      return;
    }

    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  }

  bindEvents();
  render();
  initializeFirebaseRuntime();
  registerServiceWorker();
})();
