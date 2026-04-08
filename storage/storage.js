(function () {
  const STORAGE_KEYS = {
    lockState: "lockState",
    settings: "settings",
    questionLists: "questionLists",
    enabledListIds: "enabledListIds",
    questions: "questions",
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
    sameListBiasLimit: 3
  };

  const DEFAULT_QUIZ_STATE = {
    currentQuestionRef: null,
    consecutiveUnseenCount: 0,
    recentListIds: [],
    recentQuestionHistory: [],
    currentSession: null
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function buildQuestionKey(listId, questionId) {
    return `${listId}:${questionId}`;
  }

  function normalizeQuestionListItem(item, fallback = {}) {
    const safeItem = item && typeof item === "object" ? item : {};
    const safeFallback = fallback && typeof fallback === "object" ? fallback : {};
    const id = safeItem.id ?? safeFallback.id;

    if (typeof id !== "string" || id.trim() === "") {
      return null;
    }

    return {
      enabled: true,
      pausedAt: null,
      ...safeFallback,
      ...safeItem,
      id
    };
  }

  function normalizeQuestionItem(item, fallback = {}) {
    const safeItem = item && typeof item === "object" ? item : {};
    const safeFallback = fallback && typeof fallback === "object" ? fallback : {};
    const listId = safeItem.listId ?? safeFallback.listId;
    const id = safeItem.id ?? safeFallback.id;

    if (
      typeof listId !== "string" ||
      listId.trim() === "" ||
      typeof id !== "string" ||
      id.trim() === ""
    ) {
      return null;
    }

    return {
      prompt: "",
      displayAnswer: "",
      answerReading: "",
      explanation: "",
      ...safeFallback,
      ...safeItem,
      listId,
      id
    };
  }

  function normalizeQuestionLists(storedLists) {
    const storedById = new Map(
      Array.isArray(storedLists)
        ? storedLists
            .map((item) => normalizeQuestionListItem(item))
            .filter(Boolean)
            .map((item) => [item.id, item])
        : []
    );

    const normalizedDefaults = globalThis.LockBrowserDefaults.DEFAULT_QUESTION_LISTS
      .map((list) => normalizeQuestionListItem(storedById.get(list.id), list))
      .filter(Boolean);
    const defaultIds = new Set(normalizedDefaults.map((item) => item.id));
    const extraStoredLists = Array.isArray(storedLists)
      ? storedLists
          .map((item) => normalizeQuestionListItem(item))
          .filter((item) => item && !defaultIds.has(item.id))
      : [];

    return [...normalizedDefaults, ...extraStoredLists];
  }

  function normalizeSettings(settings) {
    return {
      ...DEFAULT_SETTINGS,
      ...(settings && typeof settings === "object" ? settings : {})
    };
  }

  function normalizeQuestions(storedQuestions) {
    const storedByKey = new Map(
      Array.isArray(storedQuestions)
        ? storedQuestions
            .map((question) => normalizeQuestionItem(question))
            .filter(Boolean)
            .map((question) => [buildQuestionKey(question.listId, question.id), question])
        : []
    );

    const normalizedDefaults = globalThis.LockBrowserDefaults.DEFAULT_QUESTIONS
      .map((question) =>
        normalizeQuestionItem(
          storedByKey.get(buildQuestionKey(question.listId, question.id)),
          question
        )
      )
      .filter(Boolean);
    const defaultKeys = new Set(
      normalizedDefaults.map((question) => buildQuestionKey(question.listId, question.id))
    );
    const extraStoredQuestions = Array.isArray(storedQuestions)
      ? storedQuestions
          .map((question) => normalizeQuestionItem(question))
          .filter(
            (question) =>
              question &&
              !defaultKeys.has(buildQuestionKey(question.listId, question.id))
          )
      : [];

    return [...normalizedDefaults, ...extraStoredQuestions];
  }

  function normalizeEnabledListIds(storedEnabledListIds, questionLists) {
    const validListIds = new Set(questionLists.map((list) => list.id));
    const fromStorage = Array.isArray(storedEnabledListIds)
      ? storedEnabledListIds.filter((listId) => validListIds.has(listId))
      : [];

    if (fromStorage.length > 0) {
      return fromStorage;
    }

    return questionLists.filter((list) => list.enabled).map((list) => list.id);
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
    const normalizedRecentQuestionHistory = Array.isArray(quizState?.recentQuestionHistory)
      ? quizState.recentQuestionHistory.slice(-10)
      : [];

    return {
      ...DEFAULT_QUIZ_STATE,
      ...(quizState || {}),
      recentQuestionHistory: normalizedRecentQuestionHistory
    };
  }

  function normalizeStore(rawStore) {
    const questionLists = normalizeQuestionLists(rawStore[STORAGE_KEYS.questionLists]);
    const enabledListIds = normalizeEnabledListIds(rawStore[STORAGE_KEYS.enabledListIds], questionLists);
    const syncedQuestionLists = questionLists.map((list) => ({
      ...list,
      enabled: enabledListIds.includes(list.id)
    }));

    return {
      [STORAGE_KEYS.settings]: normalizeSettings(rawStore[STORAGE_KEYS.settings]),
      [STORAGE_KEYS.questionLists]: syncedQuestionLists,
      [STORAGE_KEYS.enabledListIds]: enabledListIds,
      [STORAGE_KEYS.questions]: normalizeQuestions(rawStore[STORAGE_KEYS.questions]),
      [STORAGE_KEYS.progressByKey]: normalizeProgressByKey(rawStore[STORAGE_KEYS.progressByKey]),
      [STORAGE_KEYS.quizState]: normalizeQuizState(rawStore[STORAGE_KEYS.quizState])
    };
  }

  async function ensureDataStore() {
    const rawStore = await chrome.storage.local.get(Object.values(STORAGE_KEYS));
    const normalizedStore = normalizeStore(rawStore);
    await chrome.storage.local.set(normalizedStore);
    return clone(normalizedStore);
  }

  async function getDataStore() {
    return ensureDataStore();
  }

  async function setDataStore(partialStore) {
    await chrome.storage.local.set(partialStore);
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

  async function getQuestionLists() {
    const store = await getDataStore();
    return clone(store[STORAGE_KEYS.questionLists]);
  }

  async function getQuestionsByListId(listId) {
    const store = await getDataStore();
    return clone(
      store[STORAGE_KEYS.questions].filter((question) => question.listId === listId)
    );
  }

  async function getListProgressSummary(listId) {
    const store = await getDataStore();
    const questions = store[STORAGE_KEYS.questions].filter((question) => question.listId === listId);
    const total = questions.length;
    const started = questions.filter((question) => !getProgress(store, question.listId, question.id).isUnseen)
      .length;

    return {
      total,
      started,
      startedRate: total > 0 ? started / total : 0
    };
  }

  async function importQuestionListData(payload) {
    const store = await getDataStore();
    const normalizedList = normalizeQuestionListItem({
      ...(payload?.list || {}),
      name: payload?.list?.name || payload?.list?.title
    });
    const normalizedQuestions = Array.isArray(payload?.questions)
      ? payload.questions
          .map((question) =>
            normalizeQuestionItem({
              ...question,
              listId: question?.listId || normalizedList?.id
            })
          )
          .filter(Boolean)
      : [];

    if (!normalizedList) {
      throw new Error("Question list data is invalid.");
    }

    const existingLists = store[STORAGE_KEYS.questionLists].filter((list) => list.id !== normalizedList.id);
    const existingQuestions = store[STORAGE_KEYS.questions].filter(
      (question) => question.listId !== normalizedList.id
    );
    const nextQuestionLists = [...existingLists, normalizedList];
    const nextQuestions = [...existingQuestions, ...normalizedQuestions];
    const nextEnabledListIds = nextQuestionLists.filter((list) => list.enabled).map((list) => list.id);

    await setDataStore({
      [STORAGE_KEYS.questionLists]: nextQuestionLists,
      [STORAGE_KEYS.questions]: nextQuestions,
      [STORAGE_KEYS.enabledListIds]: nextEnabledListIds
    });

    return {
      list: clone(normalizedList),
      importedCount: normalizedQuestions.length
    };
  }

  function findQuestion(store, listId, questionId) {
    return store[STORAGE_KEYS.questions].find(
      (question) => question.listId === listId && question.id === questionId
    );
  }

  function getProgress(store, listId, questionId) {
    return {
      ...DEFAULT_PROGRESS,
      ...(store[STORAGE_KEYS.progressByKey][buildQuestionKey(listId, questionId)] || {})
    };
  }

  globalThis.LockBrowserStorage = {
    STORAGE_KEYS,
    DEFAULT_PROGRESS,
    DEFAULT_SETTINGS,
    DEFAULT_QUIZ_STATE,
    buildQuestionKey,
    ensureDataStore,
    getDataStore,
    setDataStore,
    getSettings,
    updateSettings,
    getQuestionLists,
    getQuestionsByListId,
    getListProgressSummary,
    importQuestionListData,
    findQuestion,
    getProgress
  };
})();
