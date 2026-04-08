(function () {
  const STORAGE_KEYS = {
    lockState: "lockState",
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

  function normalizeQuestionLists(storedLists) {
    const storedById = new Map(
      Array.isArray(storedLists) ? storedLists.map((item) => [item.id, item]) : []
    );

    return globalThis.LockBrowserDefaults.DEFAULT_QUESTION_LISTS.map((list) => ({
      ...list,
      ...(storedById.get(list.id) || {})
    }));
  }

  function normalizeQuestions(storedQuestions) {
    const storedByKey = new Map(
      Array.isArray(storedQuestions)
        ? storedQuestions.map((question) => [buildQuestionKey(question.listId, question.id), question])
        : []
    );

    return globalThis.LockBrowserDefaults.DEFAULT_QUESTIONS.map((question) => ({
      ...question,
      ...(storedByKey.get(buildQuestionKey(question.listId, question.id)) || {})
    }));
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
    DEFAULT_QUIZ_STATE,
    buildQuestionKey,
    ensureDataStore,
    getDataStore,
    setDataStore,
    findQuestion,
    getProgress
  };
})();
