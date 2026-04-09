(function () {
  const STORAGE_KEYS = {
    lockState: "lockState",
    settings: "settings",
    questionData: "questionData",
    listSummaries: "listSummaries",
    cardSummaries: "cardSummaries",
    // Legacy projection keys kept only for read/write compatibility during the rename.
    questionLists: "questionLists",
    questions: "questions",
    enabledListIds: "enabledListIds",
    progressByKey: "progressByKey",
    quizState: "quizState"
  };

  const DEFAULT_PROGRESS = {
    level: 0,
    isUnseen: true,
    reviewAt: null
  };

  const DEFAULT_SETTINGS = {
    lockIntervalMs: 60 * 1000,
    maxConsecutiveUnseen: 2,
    sameListBiasLimit: 3,
    questionsPerLock: 1,
    incorrectPenaltyMs: 10 * 1000,
    incorrectReviewDelayMs: 10 * 1000,
    answerInputMode: "candidate",
    autoStartLockOnBrowserOpen: true,
    excludedSites: []
  };

  const SETTINGS_LIMITS = {
    minLockIntervalMs: 1000,
    maxLockIntervalMs: 24 * 60 * 60 * 1000,
    minMaxConsecutiveUnseen: 1,
    maxMaxConsecutiveUnseen: 10,
    minSameListBiasLimit: 1,
    maxSameListBiasLimit: 10,
    minQuestionsPerLock: 1,
    maxQuestionsPerLock: 20,
    minIncorrectPenaltyMs: 0,
    maxIncorrectPenaltyMs: 24 * 60 * 60 * 1000,
    minIncorrectReviewDelayMs: 0,
    maxIncorrectReviewDelayMs: 24 * 60 * 60 * 1000
  };

  const DEFAULT_QUIZ_STATE = {
    currentCardRef: null,
    consecutiveUnseenCount: 0,
    recentListIds: [],
    recentCardHistory: [],
    currentSession: null
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createProgressKey(listId, cardId) {
    return `${listId}:${cardId}`;
  }

  function normalizeSettings(settings) {
    const safeSettings = settings && typeof settings === "object" ? settings : {};
    const legacyIncorrectDelayMs = normalizeIntegerSetting(
      safeSettings.incorrectRetryDelayMs,
      DEFAULT_SETTINGS.incorrectPenaltyMs,
      SETTINGS_LIMITS.minIncorrectPenaltyMs,
      SETTINGS_LIMITS.maxIncorrectPenaltyMs
    );

    return {
      lockIntervalMs: normalizeIntegerSetting(
        safeSettings.lockIntervalMs,
        DEFAULT_SETTINGS.lockIntervalMs,
        SETTINGS_LIMITS.minLockIntervalMs,
        SETTINGS_LIMITS.maxLockIntervalMs
      ),
      maxConsecutiveUnseen: normalizeIntegerSetting(
        safeSettings.maxConsecutiveUnseen,
        DEFAULT_SETTINGS.maxConsecutiveUnseen,
        SETTINGS_LIMITS.minMaxConsecutiveUnseen,
        SETTINGS_LIMITS.maxMaxConsecutiveUnseen
      ),
      sameListBiasLimit: normalizeIntegerSetting(
        safeSettings.sameListBiasLimit,
        DEFAULT_SETTINGS.sameListBiasLimit,
        SETTINGS_LIMITS.minSameListBiasLimit,
        SETTINGS_LIMITS.maxSameListBiasLimit
      ),
      questionsPerLock: normalizeIntegerSetting(
        safeSettings.questionsPerLock,
        DEFAULT_SETTINGS.questionsPerLock,
        SETTINGS_LIMITS.minQuestionsPerLock,
        SETTINGS_LIMITS.maxQuestionsPerLock
      ),
      incorrectPenaltyMs: normalizeIntegerSetting(
        safeSettings.incorrectPenaltyMs,
        legacyIncorrectDelayMs,
        SETTINGS_LIMITS.minIncorrectPenaltyMs,
        SETTINGS_LIMITS.maxIncorrectPenaltyMs
      ),
      incorrectReviewDelayMs: normalizeIntegerSetting(
        safeSettings.incorrectReviewDelayMs,
        legacyIncorrectDelayMs,
        SETTINGS_LIMITS.minIncorrectReviewDelayMs,
        SETTINGS_LIMITS.maxIncorrectReviewDelayMs
      ),
      answerInputMode:
        safeSettings.answerInputMode === "keyboard" || safeSettings.answerInputMode === "candidate"
          ? safeSettings.answerInputMode
          : DEFAULT_SETTINGS.answerInputMode,
      autoStartLockOnBrowserOpen:
        typeof safeSettings.autoStartLockOnBrowserOpen === "boolean"
          ? safeSettings.autoStartLockOnBrowserOpen
          : DEFAULT_SETTINGS.autoStartLockOnBrowserOpen,
      excludedSites: normalizeExcludedSites(
        safeSettings.excludedSites,
        DEFAULT_SETTINGS.excludedSites
      )
    };
  }

  function normalizeIntegerSetting(value, fallback, min, max) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return fallback;
    }

    const normalizedValue = Math.round(numericValue);
    return Math.min(max, Math.max(min, normalizedValue));
  }

  function normalizeExcludedSites(value, fallback) {
    if (!Array.isArray(value)) {
      return Array.isArray(fallback) ? [...fallback] : [];
    }

    const uniqueHosts = new Set();
    value.forEach((entry) => {
      const host = normalizeExcludedSiteEntry(entry);
      if (host) {
        uniqueHosts.add(host);
      }
    });

    return Array.from(uniqueHosts);
  }

  function normalizeExcludedSiteEntry(value) {
    const rawValue = String(value || "").trim().toLowerCase();
    if (!rawValue) {
      return "";
    }

    const candidate = rawValue.replace(/\/+$/, "");
    try {
      const url = candidate.includes("://")
        ? new URL(candidate)
        : new URL(`https://${candidate}`);
      return normalizeHostname(url.hostname);
    } catch (error) {
      return normalizeHostname(candidate);
    }
  }

  function normalizeHostname(value) {
    const hostname = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\.+$/, "");

    if (!hostname || /\s/.test(hostname) || hostname.includes("/")) {
      return "";
    }

    return hostname;
  }

  function normalizeProgressByKey(progressByKey) {
    if (!progressByKey || typeof progressByKey !== "object") {
      return {};
    }

    const nextProgressByKey = {};
    for (const [key, progress] of Object.entries(progressByKey)) {
      nextProgressByKey[key] = {
        ...DEFAULT_PROGRESS,
        ...(progress || {})
      };
    }

    return nextProgressByKey;
  }

  function normalizeQuizState(quizState) {
    const normalizedRecentCardHistory = Array.isArray(
      quizState?.recentCardHistory || quizState?.recentQuestionHistory
    )
      ? (quizState.recentCardHistory || quizState.recentQuestionHistory).slice(-10)
      : [];
    const currentCardRef =
      quizState?.currentCardRef ||
      quizState?.currentQuestionRef ||
      null;

    return {
      ...DEFAULT_QUIZ_STATE,
      ...(quizState || {}),
      currentCardRef,
      recentCardHistory: normalizedRecentCardHistory
    };
  }

  function normalizeQuestionDataRoot(questionData) {
    const source =
      questionData && typeof questionData === "object"
        ? questionData
        : globalThis.LockBrowserDefaults.DEFAULT_QUESTION_DATA_V2 ||
          globalThis.LockBrowserSchema.createEmptyQuestionDataV2();
    const normalized = globalThis.LockBrowserSchema.normalizeQuestionData(source);
    const validation = globalThis.LockBrowserSchema.validateQuestionData(normalized);

    if (!validation.ok) {
      throw new Error(`Question data is invalid: ${validation.errors.join(" / ")}`);
    }

    return normalized;
  }

  function buildCompatibilityProjections(questionData) {
    const listSummaries = questionData.lists.map(projectListSummary);
    const enabledListIds = questionData.lists
      .filter((list) => list.enabled !== false)
      .map((list) => list.id);
    const cardSummaries = globalThis.LockBrowserResolvedCard
      .getResolvedCards(questionData)
      .map(projectResolvedCardSummary);

    return {
      listSummaries,
      enabledListIds,
      cardSummaries
    };
  }

  function projectListSummary(list) {
    return {
      id: list.id,
      title: list.title,
      name: list.title,
      description: list.description || "",
      enabled: list.enabled !== false,
      pausedAt: list.pausedAt ?? null
    };
  }

  function projectResolvedCardSummary(resolvedCard) {
    const backText = partsToPlainText(resolvedCard.fields?.back);
    const readingText = partsToPlainText(resolvedCard.fields?.reading) || backText;
    const explanationText = partsToPlainText(resolvedCard.explanationParts);
    return {
      listId: resolvedCard.listId,
      itemId: resolvedCard.itemId,
      id: resolvedCard.cardId,
      prompt: partsToPlainText(resolvedCard.promptParts),
      displayAnswer: backText,
      answerReading: readingText,
      explanation: explanationText,
      cardId: resolvedCard.cardId,
      inputMode: resolvedCard.inputMode || "keyboard",
      acceptedAnswers: Array.isArray(resolvedCard.answer?.accepted)
        ? [...resolvedCard.answer.accepted]
        : [],
      promptParts: clone(resolvedCard.promptParts || []),
      explanationParts: clone(resolvedCard.explanationParts || []),
      answer: clone(resolvedCard.answer || { type: "text", accepted: [] }),
      fields: clone(resolvedCard.fields || {}),
      template: resolvedCard.template || "front-to-back",
      tags: Array.isArray(resolvedCard.tags) ? [...resolvedCard.tags] : [],
      canonicalAnswer: resolvedCard.canonicalAnswer || readingText || backText
    };
  }

  function partsToPlainText(parts) {
    if (!Array.isArray(parts)) {
      return "";
    }

    return parts
      .map((part) => (part && part.type === "text" ? String(part.value || "") : ""))
      .join("");
  }

  function normalizeStore(rawStore) {
    const questionData = normalizeQuestionDataRoot(rawStore[STORAGE_KEYS.questionData]);
    const projections = buildCompatibilityProjections(questionData);

    return {
      [STORAGE_KEYS.settings]: normalizeSettings(rawStore[STORAGE_KEYS.settings]),
      [STORAGE_KEYS.questionData]: questionData,
      [STORAGE_KEYS.listSummaries]: projections.listSummaries,
      [STORAGE_KEYS.cardSummaries]: projections.cardSummaries,
      [STORAGE_KEYS.questionLists]: projections.listSummaries,
      [STORAGE_KEYS.questions]: projections.cardSummaries,
      [STORAGE_KEYS.enabledListIds]: projections.enabledListIds,
      [STORAGE_KEYS.progressByKey]: normalizeProgressByKey(rawStore[STORAGE_KEYS.progressByKey]),
      [STORAGE_KEYS.quizState]: normalizeQuizState(rawStore[STORAGE_KEYS.quizState])
    };
  }

  function getPersistedStore(store) {
    return {
      [STORAGE_KEYS.settings]: store[STORAGE_KEYS.settings],
      [STORAGE_KEYS.questionData]: store[STORAGE_KEYS.questionData],
      [STORAGE_KEYS.enabledListIds]: store[STORAGE_KEYS.enabledListIds],
      [STORAGE_KEYS.progressByKey]: store[STORAGE_KEYS.progressByKey],
      [STORAGE_KEYS.quizState]: store[STORAGE_KEYS.quizState]
    };
  }

  async function ensureDataStore() {
    const rawStore = await chrome.storage.local.get([
      STORAGE_KEYS.lockState,
      STORAGE_KEYS.settings,
      STORAGE_KEYS.questionData,
      STORAGE_KEYS.progressByKey,
      STORAGE_KEYS.quizState,
      STORAGE_KEYS.enabledListIds
    ]);
    const normalizedStore = normalizeStore(rawStore);
    await chrome.storage.local.set(getPersistedStore(normalizedStore));
    return clone(normalizedStore);
  }

  async function getDataStore() {
    return ensureDataStore();
  }

  async function setDataStore(partialStore) {
    const currentStore = await ensureDataStore();
    const nextStore = {
      ...currentStore
    };

    if (partialStore[STORAGE_KEYS.settings]) {
      nextStore[STORAGE_KEYS.settings] = normalizeSettings({
        ...currentStore[STORAGE_KEYS.settings],
        ...partialStore[STORAGE_KEYS.settings]
      });
    }

    if (partialStore[STORAGE_KEYS.questionData]) {
      nextStore[STORAGE_KEYS.questionData] = normalizeQuestionDataRoot(
        partialStore[STORAGE_KEYS.questionData]
      );
    } else if (partialStore[STORAGE_KEYS.questionLists] || partialStore[STORAGE_KEYS.questions]) {
      nextStore[STORAGE_KEYS.questionData] = applyLegacyProjectionMutations(
        currentStore[STORAGE_KEYS.questionData],
        partialStore
      );
    }

    if (partialStore[STORAGE_KEYS.progressByKey]) {
      nextStore[STORAGE_KEYS.progressByKey] = normalizeProgressByKey(
        partialStore[STORAGE_KEYS.progressByKey]
      );
    }

    if (partialStore[STORAGE_KEYS.quizState]) {
      nextStore[STORAGE_KEYS.quizState] = normalizeQuizState(partialStore[STORAGE_KEYS.quizState]);
    }

    const normalizedNextStore = normalizeStore(nextStore);
    await chrome.storage.local.set(getPersistedStore(normalizedNextStore));
  }

  function applyLegacyProjectionMutations(questionData, partialStore) {
    const nextQuestionData = clone(questionData);

    if (Array.isArray(partialStore[STORAGE_KEYS.questionLists])) {
      const listById = new Map(nextQuestionData.lists.map((list) => [list.id, list]));
      partialStore[STORAGE_KEYS.questionLists].forEach((projectedList) => {
        if (!projectedList || typeof projectedList !== "object" || !projectedList.id) {
          return;
        }

        const existingList = listById.get(projectedList.id);
        if (!existingList) {
          listById.set(projectedList.id, {
            id: projectedList.id,
            title: projectedList.title || projectedList.name || projectedList.id,
            description: projectedList.description || "",
            enabled: projectedList.enabled !== false,
            pausedAt: projectedList.pausedAt ?? null,
            items: []
          });
          return;
        }

        existingList.title = projectedList.title || projectedList.name || existingList.title;
        existingList.description = projectedList.description || existingList.description || "";
        existingList.enabled = projectedList.enabled !== false;
        existingList.pausedAt = projectedList.pausedAt ?? null;
      });

      nextQuestionData.lists = Array.from(listById.values());
    }

    if (Array.isArray(partialStore[STORAGE_KEYS.questions])) {
      const itemsByList = new Map(nextQuestionData.lists.map((list) => [list.id, list.items]));

      partialStore[STORAGE_KEYS.questions].forEach((projectedQuestion) => {
        if (!projectedQuestion || typeof projectedQuestion !== "object") {
          return;
        }

        const listId = projectedQuestion.listId;
        if (!itemsByList.has(listId)) {
          nextQuestionData.lists.push({
            id: listId,
            title: listId,
            description: "",
            enabled: true,
            pausedAt: null,
            items: []
          });
          itemsByList.set(listId, nextQuestionData.lists[nextQuestionData.lists.length - 1].items);
        }

        const nextItem = convertLegacyQuestionToItem(projectedQuestion);
        const items = itemsByList.get(listId);
        const nextItems = items.filter((item) => item.id !== nextItem.id);
        nextItems.push(nextItem);
        itemsByList.set(listId, nextItems);
      });

      nextQuestionData.lists = nextQuestionData.lists.map((list) => ({
        ...list,
        items: itemsByList.get(list.id) || list.items
      }));
    }

    if (Array.isArray(partialStore[STORAGE_KEYS.enabledListIds])) {
      const enabledIds = new Set(partialStore[STORAGE_KEYS.enabledListIds]);
      nextQuestionData.lists = nextQuestionData.lists.map((list) => ({
        ...list,
        enabled: enabledIds.has(list.id)
      }));
    }

    return normalizeQuestionDataRoot(nextQuestionData);
  }

  async function getSettings() {
    const store = await getDataStore();
    return clone(store[STORAGE_KEYS.settings]);
  }

  async function updateSettings(patch) {
    const store = await getDataStore();
    const nextSettings = normalizeSettings({
      ...store[STORAGE_KEYS.settings],
      ...(patch || {})
    });

    await setDataStore({
      [STORAGE_KEYS.settings]: nextSettings
    });

    return clone(nextSettings);
  }

  async function getQuestionData() {
    const store = await getDataStore();
    return clone(store[STORAGE_KEYS.questionData]);
  }

  async function saveQuestionData(questionData) {
    const normalizedQuestionData = normalizeQuestionDataRoot(questionData);
    await setDataStore({
      [STORAGE_KEYS.questionData]: normalizedQuestionData
    });
    return clone(normalizedQuestionData);
  }

  async function getAllLists() {
    const store = await getDataStore();
    return clone(store[STORAGE_KEYS.questionData].lists);
  }

  async function getAllResolvedCards() {
    const questionData = await getQuestionData();
    return clone(globalThis.LockBrowserResolvedCard.getResolvedCards(questionData));
  }

  async function getListById(listId) {
    const store = await getDataStore();
    const list = store[STORAGE_KEYS.questionData].lists.find((item) => item.id === listId) || null;
    return clone(list);
  }

  async function getMediaEntries() {
    const questionData = await getQuestionData();
    return clone(Array.isArray(questionData.media) ? questionData.media : []);
  }

  async function getItemsByListId(listId) {
    const list = await getListById(listId);
    return clone(list?.items || []);
  }

  async function getCardsByListId(listId) {
    const questionData = await getQuestionData();
    return clone(globalThis.LockBrowserResolvedCard.getResolvedCardsByListId(questionData, listId));
  }

  async function getListSummaries() {
    const store = await getDataStore();
    return clone(store[STORAGE_KEYS.listSummaries]);
  }

  async function getLegacyListSummary(listId) {
    const store = await getDataStore();
    const listSummary =
      store[STORAGE_KEYS.listSummaries].find((list) => list.id === listId) || null;
    return clone(listSummary);
  }

  async function getCardSummariesByListId(listId) {
    const store = await getDataStore();
    return clone(
      store[STORAGE_KEYS.cardSummaries].filter((card) => card.listId === listId)
    );
  }

  async function getResolvedCardById(listId, cardId) {
    const questionData = await getQuestionData();
    return clone(globalThis.LockBrowserResolvedCard.findResolvedCard(questionData, listId, cardId));
  }

  async function getListProgressSummary(listId) {
    const store = await getDataStore();
    const cardSummaries = store[STORAGE_KEYS.cardSummaries].filter((card) => card.listId === listId);
    const total = cardSummaries.length;
    let unseen = 0;
    let learning = 0;
    let review = 0;
    let mastered = 0;

    cardSummaries.forEach((cardSummary) => {
      const progress = getProgress(store, cardSummary.listId, cardSummary.id);
      const rank = getProgressRank(progress);

      if (rank === "unseen") {
        unseen += 1;
      } else if (rank === "mastered") {
        mastered += 1;
      } else if (rank === "review") {
        review += 1;
      } else {
        learning += 1;
      }
    });

    const retained = review + mastered;
    const started = learning + retained;

    return {
      total,
      unseenCount: unseen,
      learningCount: learning,
      reviewCount: review,
      masteredCount: mastered,
      unseen,
      learning,
      review,
      mastered,
      retained,
      started,
      unseenRate: total > 0 ? unseen / total : 0,
      learningRate: total > 0 ? learning / total : 0,
      reviewRate: total > 0 ? review / total : 0,
      masteredRate: total > 0 ? mastered / total : 0,
      retainedRate: total > 0 ? retained / total : 0,
      startedRate: total > 0 ? started / total : 0
    };
  }

  function getProgressRank(progress) {
    if (globalThis.LockBrowserProgress?.getRank) {
      return globalThis.LockBrowserProgress.getRank(progress);
    }

    if (progress?.isUnseen) {
      return "unseen";
    }

    if ((progress?.level || 0) >= 20) {
      return "mastered";
    }

    if ((progress?.level || 0) >= 4) {
      return "review";
    }

    return "learning";
  }

  async function createList(input) {
    const questionData = await getQuestionData();
    const nextId = createListId(input?.name || "new-list");
    const nextList = globalThis.LockBrowserSchema.normalizeList({
      id: nextId,
      title: String(input?.name || "New List").trim() || "New List",
      description: String(input?.description || "").trim(),
      enabled: true,
      pausedAt: null,
      items: []
    });

    questionData.lists.push(nextList);
    await saveQuestionData(questionData);
    return clone(projectListSummary(nextList));
  }

  async function upsertItem(itemInput) {
    const questionData = await getQuestionData();
    const list = questionData.lists.find((item) => item.id === itemInput.listId);

    if (!list) {
      throw new Error("List not found.");
    }

    const normalizedItem = globalThis.LockBrowserSchema.normalizeItem(itemInput);

    if (!normalizedItem) {
      throw new Error("Item data is invalid.");
    }

    const nextItems = list.items.filter((item) => item.id !== normalizedItem.id);
    nextItems.push(normalizedItem);
    list.items = nextItems;

    await saveQuestionData(questionData);
    const firstCard = (normalizedItem.cards || [])[0];
    const resolvedCard = firstCard
      ? globalThis.LockBrowserResolvedCard.resolveCard(list, normalizedItem, firstCard)
      : null;
    return clone(resolvedCard ? projectResolvedCardSummary(resolvedCard) : normalizedItem);
  }

  async function importListData(payload, options = {}) {
    const targetListId = typeof options.targetListId === "string" ? options.targetListId : null;
    const questionData = await getQuestionData();

    if (targetListId) {
      const targetList = questionData.lists.find((list) => list.id === targetListId);
      if (!targetList) {
        throw new Error("Import target list not found.");
      }

      const incoming = globalThis.LockBrowserSchema.normalizeQuestionData(payload);
      const incomingItems = incoming.lists.flatMap((list) => list.items);
      targetList.items = mergeItems(targetList.items, incomingItems);
      questionData.media = mergeMedia(questionData.media || [], incoming.media || []);
      await saveQuestionData(questionData);

      return {
        list: clone(projectListSummary(targetList)),
        importedCount: incomingItems.length
      };
    }

    const incomingQuestionData = globalThis.LockBrowserSchema.normalizeQuestionData(payload);
    questionData.lists = mergeLists(questionData.lists, incomingQuestionData.lists);
    questionData.media = mergeMedia(questionData.media || [], incomingQuestionData.media || []);
    await saveQuestionData(questionData);

    return {
      list: clone(projectListSummary(questionData.lists[questionData.lists.length - 1] || incomingQuestionData.lists[0])),
      importedCount: incomingQuestionData.lists.reduce(
        (count, list) => count + list.items.length,
        0
      )
    };
  }

  function mergeLists(existingLists, incomingLists) {
    const listById = new Map(existingLists.map((list) => [list.id, clone(list)]));

    incomingLists.forEach((incomingList) => {
      const existingList = listById.get(incomingList.id);
      if (!existingList) {
        listById.set(incomingList.id, clone(incomingList));
        return;
      }

      listById.set(incomingList.id, {
        ...existingList,
        ...incomingList,
        items: mergeItems(existingList.items || [], incomingList.items || [])
      });
    });

    return Array.from(listById.values());
  }

  function mergeItems(existingItems, incomingItems) {
    const itemById = new Map(existingItems.map((item) => [item.id, clone(item)]));

    incomingItems.forEach((incomingItem) => {
      itemById.set(incomingItem.id, clone(incomingItem));
    });

    return Array.from(itemById.values());
  }

  function mergeMedia(existingMedia, incomingMedia) {
    const mediaById = new Map(existingMedia.map((media) => [media.id, clone(media)]));

    incomingMedia.forEach((incomingEntry) => {
      mediaById.set(incomingEntry.id, clone(incomingEntry));
    });

    // TODO: Prune orphan media when we add explicit list/item/card delete cleanup rules.
    return Array.from(mediaById.values());
  }

  function isNewSchemaItem(value) {
    return Boolean(value && typeof value === "object" && value.fields && value.cards);
  }

  function convertLegacyQuestionToItem(questionInput) {
    const id = typeof questionInput.id === "string" ? questionInput.id : `item-${Date.now().toString(36)}`;
    const answerReading = String(
      questionInput.answerReading || questionInput.displayAnswer || ""
    ).trim();

    return globalThis.LockBrowserSchema.normalizeItem({
      id,
      fields: {
        front: [{ type: "text", value: String(questionInput.prompt || "").trim() }],
        back: [{ type: "text", value: String(questionInput.displayAnswer || "").trim() }],
        reading: answerReading ? [{ type: "text", value: answerReading }] : [],
        explanation: questionInput.explanation
          ? [{ type: "text", value: String(questionInput.explanation).trim() }]
          : []
      },
      cards: [
        {
          id: questionInput.cardId || `${id}-card-001`,
          template: "front-to-back",
          input: {
            mode: questionInput.inputMode || "keyboard"
          },
          answer: {
            type: "text",
            accepted: answerReading ? [answerReading] : []
          }
        }
      ],
      tags: Array.isArray(questionInput.tags) ? questionInput.tags : []
    });
  }

  function findCardSummary(store, listId, cardId) {
    return store[STORAGE_KEYS.cardSummaries].find(
      (card) => card.listId === listId && card.id === cardId
    );
  }

  function findResolvedCard(store, listId, cardId) {
    return (
      globalThis.LockBrowserResolvedCard.findResolvedCard(
        store[STORAGE_KEYS.questionData],
        listId,
        cardId
      ) || null
    );
  }

  function getProgress(store, listId, cardId) {
    return {
      ...DEFAULT_PROGRESS,
      ...(store[STORAGE_KEYS.progressByKey][createProgressKey(listId, cardId)] || {})
    };
  }

  function createListId(name) {
    const base = String(name || "list")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    return `${base || "list"}-${Date.now().toString(36)}`;
  }

  globalThis.LockBrowserStorage = {
    STORAGE_KEYS,
    DEFAULT_PROGRESS,
    DEFAULT_SETTINGS,
    SETTINGS_LIMITS,
    DEFAULT_QUIZ_STATE,
    createProgressKey,
    ensureDataStore,
    getDataStore,
    setDataStore,
    getSettings,
    updateSettings,
    getQuestionData,
    saveQuestionData,
    getAllLists,
    getAllResolvedCards,
    getListById,
    getMediaEntries,
    getItemsByListId,
    getCardsByListId,
    getListSummaries,
    getCardSummariesByListId,
    getLegacyListSummary,
    getResolvedCardById,
    getListProgressSummary,
    createList,
    upsertItem,
    importListData,
    findCardSummary,
    findResolvedCard,
    getProgress,
    normalizeExcludedSiteEntry,
    // Legacy aliases kept so older callers can keep reading during migration.
    getQuestionLists: getListSummaries,
    getQuestionList: getLegacyListSummary,
    getQuestionsByListId: getCardSummariesByListId,
    createQuestionList: createList,
    upsertQuestion: upsertItem,
    importQuestionListData: importListData,
    findQuestion: findCardSummary
  };
})();


