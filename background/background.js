importScripts(
  "../data/default-data.js",
  "../storage/storage.js",
  "../logic/progress-manager.js",
  "../logic/question-selector.js",
  "../logic/lock-state-manager.js"
);

const RELOCK_ALARM_NAME = "relock-all-tabs";
const LOG_PREFIX = "[lockBrowser]";
const DEBUG_LOG_PREFIX = "[lockBrowser/debug]";

chrome.runtime.onInstalled.addListener(async () => {
  await LockBrowserStorage.ensureDataStore();
  await initializeLockBehavior({ forceApply: true });
});

chrome.runtime.onStartup.addListener(async () => {
  await LockBrowserStorage.ensureDataStore();
  await initializeLockBehavior({ forceApply: false });
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== "complete") {
    return;
  }

  const state = await LockBrowserLockState.getLockState();
  await sendLockStateToTab(tabId, state);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse(result))
    .catch((error) => {
      console.error("Failed to handle message:", error);
      sendResponse({ ok: false, error: String(error) });
    });

  return true;
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== RELOCK_ALARM_NAME) {
    return;
  }

  await LockBrowserLockState.setLockState({
    isLocked: true,
    isPaused: false,
    pausedAt: null,
    unlockUntil: null
  });
  await broadcastLockState();
});

async function handleMessage(message) {
  switch (message?.type) {
    case "GET_CURRENT_QUESTION": {
      const settings = await LockBrowserStorage.getSettings();
      const question = await getCurrentQuestion(settings);
      return {
        ok: true,
        question,
        answerInputMode: settings.answerInputMode
      };
    }

    case "SUBMIT_ANSWER": {
      const result = await submitAnswer({
        listId: String(message.listId || ""),
        questionId: String(message.questionId || ""),
        answerReading: String(message.answerReading || "")
      });
      return { ok: true, ...result };
    }

    case "UNLOCK_REQUEST": {
      const settings = await LockBrowserStorage.getSettings();
      const state = await LockBrowserLockState.unlockForDuration(
        settings.lockIntervalMs,
        async (_, unlockUntil) => {
          await scheduleRelock(unlockUntil);
          console.log(
            DEBUG_LOG_PREFIX,
            "next relock scheduled",
            new Date(unlockUntil).toISOString(),
            unlockUntil
          );
          await broadcastLockState();
        }
      );

      console.log(LOG_PREFIX, "lock released", { unlockUntil: state.unlockUntil });
      return { ok: true, state };
    }

    case "TOGGLE_PAUSE": {
      const settings = await LockBrowserStorage.getSettings();
      const state = await togglePause(settings.lockIntervalMs);
      return { ok: true, state };
    }

    case "SET_LIST_ENABLED": {
      const listId = String(message.listId || "");
      const enabled = Boolean(message.enabled);
      const store = await updateQuestionListEnabled(listId, enabled);
      return {
        ok: true,
        questionLists: store[LockBrowserStorage.STORAGE_KEYS.questionLists],
        enabledListIds: store[LockBrowserStorage.STORAGE_KEYS.enabledListIds]
      };
    }

    case "REGISTER_INCORRECT_ANSWER": {
      const result = await registerIncorrectAnswer({
        listId: String(message.listId || ""),
        questionId: String(message.questionId || "")
      });
      return { ok: true, ...result };
    }

    default:
      return { ok: false, error: "Unknown message type." };
  }
}

async function initializeLockBehavior({ forceApply }) {
  const settings = await LockBrowserStorage.getSettings();
  const currentState = await LockBrowserLockState.getLockState();

  if (settings.autoStartLockOnBrowserOpen) {
    if (currentState.isLocked && !currentState.isPaused && !forceApply) {
      await LockBrowserLockState.syncAlarmWithState(RELOCK_ALARM_NAME, async () => {
        await broadcastLockState();
      });
      return;
    }

    await chrome.alarms.clear(RELOCK_ALARM_NAME);
    await LockBrowserLockState.setLockState({
      isLocked: true,
      isPaused: false,
      pausedAt: null,
      unlockUntil: null
    });
    await broadcastLockState();
    return;
  }

  if (
    forceApply ||
    currentState.isLocked ||
    currentState.isPaused ||
    currentState.unlockUntil !== null
  ) {
    await chrome.alarms.clear(RELOCK_ALARM_NAME);
    await LockBrowserLockState.setLockState({
      isLocked: false,
      isPaused: false,
      pausedAt: null,
      unlockUntil: null
    });
    await broadcastLockState();
  }
}

async function getCurrentQuestion(settings) {
  const store = await LockBrowserStorage.getDataStore();
  const quizState = store[LockBrowserStorage.STORAGE_KEYS.quizState];
  const excludedQuestionKeys = quizState.currentSession?.answeredQuestionKeys || [];

  if (quizState.currentQuestionRef) {
    const existing = LockBrowserStorage.findQuestion(
      store,
      quizState.currentQuestionRef.listId,
      quizState.currentQuestionRef.questionId
    );

    if (existing && isQuestionActive(existing, store)) {
      return toPublicQuestion(
        existing,
        LockBrowserStorage.getProgress(store, existing.listId, existing.id)
      );
    }

    await LockBrowserStorage.setDataStore({
      [LockBrowserStorage.STORAGE_KEYS.quizState]: {
        ...quizState,
        currentQuestionRef: null,
        currentSession: null
      }
    });
  }

  const selected = LockBrowserQuestionSelector.selectNextQuestion({
    questionLists: store[LockBrowserStorage.STORAGE_KEYS.questionLists],
    enabledListIds: store[LockBrowserStorage.STORAGE_KEYS.enabledListIds],
    questions: store[LockBrowserStorage.STORAGE_KEYS.questions],
    progressByKey: store[LockBrowserStorage.STORAGE_KEYS.progressByKey],
    settings,
    consecutiveUnseenCount: quizState.consecutiveUnseenCount,
    recentListIds: quizState.recentListIds,
    excludedQuestionKeys,
    now: Date.now()
  });

  if (!selected) {
    await LockBrowserStorage.setDataStore({
      [LockBrowserStorage.STORAGE_KEYS.quizState]: {
        ...quizState,
        currentQuestionRef: null,
        currentSession: null
      }
    });

    // If nothing can be asked, abort the current lock so the user does not get stuck.
    await LockBrowserLockState.setLockState({
      isLocked: false,
      isPaused: false,
      pausedAt: null,
      unlockUntil: null
    });
    await chrome.alarms.clear(RELOCK_ALARM_NAME);
    await broadcastLockState();
    return null;
  }

  const availableQuestionCount = LockBrowserQuestionSelector.countSelectableQuestions({
    questionLists: store[LockBrowserStorage.STORAGE_KEYS.questionLists],
    enabledListIds: store[LockBrowserStorage.STORAGE_KEYS.enabledListIds],
    questions: store[LockBrowserStorage.STORAGE_KEYS.questions],
    excludedQuestionKeys
  });
  const nextSession = createQuestionSession(
    selected.question,
    quizState.currentSession,
    settings,
    availableQuestionCount
  );

  await LockBrowserStorage.setDataStore({
    [LockBrowserStorage.STORAGE_KEYS.quizState]: {
      currentQuestionRef: {
        listId: selected.question.listId,
        questionId: selected.question.id
      },
      consecutiveUnseenCount: selected.nextConsecutiveUnseenCount,
      recentListIds: appendRecentListId(quizState.recentListIds, selected.question.listId),
      recentQuestionHistory: appendRecentQuestionHistory(
        quizState.recentQuestionHistory,
        selected.question
      ),
      currentSession: nextSession
    }
  });

  console.log(DEBUG_LOG_PREFIX, "question selected", {
    listId: selected.question.listId,
    questionId: selected.question.id,
    progress: selected.progress,
    sessionId: nextSession.sessionId,
    completedQuestionCount: nextSession.completedQuestionCount,
    requiredQuestionCount: nextSession.requiredQuestionCount
  });

  return toPublicQuestion(selected.question, selected.progress);
}

function isQuestionActive(question, store) {
  const questionLists = store[LockBrowserStorage.STORAGE_KEYS.questionLists];
  const enabledListIds = new Set(store[LockBrowserStorage.STORAGE_KEYS.enabledListIds]);
  const list = questionLists.find((item) => item.id === question.listId);

  return Boolean(list && list.enabled !== false && enabledListIds.has(list.id));
}

async function submitAnswer(input) {
  const store = await LockBrowserStorage.getDataStore();
  const settings = store[LockBrowserStorage.STORAGE_KEYS.settings];
  const question = LockBrowserStorage.findQuestion(store, input.listId, input.questionId);

  if (!question) {
    throw new Error("Question not found.");
  }

  const now = Date.now();
  const progressKey = LockBrowserStorage.buildQuestionKey(question.listId, question.id);
  const currentProgress = LockBrowserStorage.getProgress(store, question.listId, question.id);
  const quizState = store[LockBrowserStorage.STORAGE_KEYS.quizState];
  const currentSession = ensureSession(quizState.currentSession, progressKey, settings);
  const isCorrect = input.answerReading === question.answerReading;
  let nextProgress = currentProgress;
  let nextProgressByKey = {
    ...store[LockBrowserStorage.STORAGE_KEYS.progressByKey]
  };
  let nextSession = currentSession;

  if (isCorrect) {
    nextProgress = LockBrowserProgress.applyCorrectProgress(
      currentProgress,
      now,
      settings.lockIntervalMs
    );
    nextProgressByKey[progressKey] = nextProgress;
    const answeredQuestionKeys = appendAnsweredQuestionKey(
      currentSession.answeredQuestionKeys,
      progressKey
    );
    nextSession = {
      ...currentSession,
      completedQuestionCount: currentSession.completedQuestionCount + 1,
      answeredQuestionKeys,
      hasIncorrectProgressUpdated: false,
      isPenaltyActive: false
    };
    console.log(DEBUG_LOG_PREFIX, "answer correct", {
      questionKey: progressKey,
      nextProgress,
      completedQuestionCount: nextSession.completedQuestionCount,
      requiredQuestionCount: nextSession.requiredQuestionCount
    });
  } else {
    const incorrectResult = applyIncorrectAttempt({
      store,
      settings,
      question,
      currentProgress,
      currentSession,
      progressKey,
      now
    });
    nextProgress = incorrectResult.nextProgress;
    nextProgressByKey = incorrectResult.nextProgressByKey;
    nextSession = incorrectResult.nextSession;
  }

  const sessionCompleted = isCorrect
    ? shouldCompleteSessionAfterCorrect({
        store,
        settings,
        quizState,
        nextSession
      })
    : false;

  await LockBrowserStorage.setDataStore({
    [LockBrowserStorage.STORAGE_KEYS.progressByKey]: nextProgressByKey,
    [LockBrowserStorage.STORAGE_KEYS.quizState]: {
      ...quizState,
      currentQuestionRef: isCorrect ? null : quizState.currentQuestionRef,
      currentSession: isCorrect
        ? sessionCompleted
          ? null
          : {
              ...nextSession,
              questionKey: null
            }
        : nextSession
    }
  });

  return {
    listId: question.listId,
    questionId: question.id,
    isCorrect,
    shouldUnlock: isCorrect && sessionCompleted,
    sessionCompleted,
    completedQuestionCount: isCorrect ? nextSession.completedQuestionCount : currentSession.completedQuestionCount,
    requiredQuestionCount: currentSession.requiredQuestionCount,
    feedback: isCorrect
      ? sessionCompleted
        ? "正解です。確認後にロックを解除できます。"
        : `正解です。次の問題へ進みます。 (${nextSession.completedQuestionCount}/${nextSession.requiredQuestionCount})`
      : "不正解です。もう一度試してください。",
    correctAnswer: question.displayAnswer,
    correctReading: question.answerReading,
    progress: nextProgress,
    rank: LockBrowserProgress.getRank(nextProgress)
  };
}

async function registerIncorrectAnswer(input) {
  const store = await LockBrowserStorage.getDataStore();
  const settings = store[LockBrowserStorage.STORAGE_KEYS.settings];
  const question = LockBrowserStorage.findQuestion(store, input.listId, input.questionId);

  if (!question) {
    throw new Error("Question not found.");
  }

  const progressKey = LockBrowserStorage.buildQuestionKey(question.listId, question.id);
  const currentProgress = LockBrowserStorage.getProgress(store, question.listId, question.id);
  const currentSession = ensureSession(
    store[LockBrowserStorage.STORAGE_KEYS.quizState].currentSession,
    progressKey,
    settings
  );

  if (currentProgress.isUnseen) {
    // Unseen questions can be retried immediately without a penalty update.
    currentSession.isPenaltyActive = false;
    await LockBrowserStorage.setDataStore({
      [LockBrowserStorage.STORAGE_KEYS.quizState]: {
        ...store[LockBrowserStorage.STORAGE_KEYS.quizState],
        currentSession
      }
    });

    return {
      shouldStartPenalty: false,
      feedback: "初めての問題なので、すぐに再挑戦できます。"
    };
  }

  const incorrectResult = applyIncorrectAttempt({
    store,
    settings,
    question,
    currentProgress,
    currentSession,
    progressKey,
    now: Date.now()
  });

  await LockBrowserStorage.setDataStore({
    [LockBrowserStorage.STORAGE_KEYS.progressByKey]: incorrectResult.nextProgressByKey,
    [LockBrowserStorage.STORAGE_KEYS.quizState]: {
      ...store[LockBrowserStorage.STORAGE_KEYS.quizState],
      currentSession: incorrectResult.nextSession
    }
  });

  return {
    shouldStartPenalty: true,
    feedback: "不正解です。もう一度試してください。"
  };
}

function applyIncorrectAttempt(input) {
  const {
    store,
    settings,
    question,
    currentProgress,
    currentSession,
    progressKey,
    now
  } = input;
  const incorrectReviewDelayMs = getIncorrectReviewDelayMs(settings);
  let nextProgress = currentProgress;
  let nextProgressByKey = {
    ...store[LockBrowserStorage.STORAGE_KEYS.progressByKey]
  };
  const nextSession = {
    ...currentSession,
    isPenaltyActive: true
  };

  if (!currentSession.hasIncorrectProgressUpdated) {
    // Incorrect progress updates only once per displayed question session.
    nextProgress = LockBrowserProgress.applyIncorrectProgress(
      currentProgress,
      now,
      incorrectReviewDelayMs
    );
    nextProgressByKey[progressKey] = nextProgress;
    nextSession.hasIncorrectProgressUpdated = true;
    console.log(DEBUG_LOG_PREFIX, "first incorrect progress update applied", {
      questionKey: progressKey,
      nextProgress,
      incorrectReviewDelayMs
    });
  } else {
    console.log(DEBUG_LOG_PREFIX, "incorrect progress update skipped for current session", {
      questionKey: progressKey,
      sessionId: currentSession.sessionId
    });
  }

  return {
    nextProgress,
    nextProgressByKey,
    nextSession,
    incorrectReviewDelayMs
  };
}

function createQuestionSession(question, previousSession, settings, availableQuestionCount) {
  return {
    sessionId: previousSession?.sessionId || createSessionId(),
    questionKey: LockBrowserStorage.buildQuestionKey(question.listId, question.id),
    hasIncorrectProgressUpdated: false,
    isPenaltyActive: false,
    completedQuestionCount: normalizeCompletedQuestionCount(previousSession?.completedQuestionCount),
    answeredQuestionKeys: normalizeAnsweredQuestionKeys(previousSession?.answeredQuestionKeys),
    requiredQuestionCount: normalizeRequiredQuestionCount(
      previousSession?.requiredQuestionCount,
      settings.questionsPerLock,
      availableQuestionCount
    )
  };
}

function ensureSession(session, questionKey, settings) {
  if (session && session.questionKey === questionKey) {
    return {
      ...session,
      completedQuestionCount: normalizeCompletedQuestionCount(session.completedQuestionCount),
      answeredQuestionKeys: normalizeAnsweredQuestionKeys(session.answeredQuestionKeys),
      requiredQuestionCount: normalizeRequiredQuestionCount(
        session.requiredQuestionCount,
        settings.questionsPerLock
      )
    };
  }

  return {
    sessionId: createSessionId(),
    questionKey,
    hasIncorrectProgressUpdated: false,
    isPenaltyActive: false,
    completedQuestionCount: 0,
    answeredQuestionKeys: [],
    requiredQuestionCount: normalizeRequiredQuestionCount(null, settings.questionsPerLock, 1)
  };
}

function normalizeCompletedQuestionCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function normalizeRequiredQuestionCount(value, fallback, availableQuestionCount) {
  if (Number.isInteger(value) && value >= 1) {
    return value;
  }

  const safeFallback = Math.max(1, fallback || 1);
  if (!Number.isInteger(availableQuestionCount) || availableQuestionCount < 1) {
    return safeFallback;
  }

  return Math.min(safeFallback, availableQuestionCount);
}

function normalizeAnsweredQuestionKeys(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function createSessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function appendAnsweredQuestionKey(answeredQuestionKeys, questionKey) {
  const nextKeys = normalizeAnsweredQuestionKeys(answeredQuestionKeys);
  if (!nextKeys.includes(questionKey)) {
    nextKeys.push(questionKey);
  }

  return nextKeys;
}

function appendRecentListId(recentListIds, listId) {
  const nextRecentListIds = Array.isArray(recentListIds) ? [...recentListIds, listId] : [listId];
  return nextRecentListIds.slice(-4);
}

function getIncorrectReviewDelayMs(settings) {
  return settings.incorrectRetryDelayMs;
}

function shouldCompleteSessionAfterCorrect(input) {
  const {
    store,
    settings,
    quizState,
    nextSession
  } = input;

  if (nextSession.completedQuestionCount >= nextSession.requiredQuestionCount) {
    return true;
  }

  const remainingSelectableCount = LockBrowserQuestionSelector.countSelectableQuestions({
    questionLists: store[LockBrowserStorage.STORAGE_KEYS.questionLists],
    enabledListIds: store[LockBrowserStorage.STORAGE_KEYS.enabledListIds],
    questions: store[LockBrowserStorage.STORAGE_KEYS.questions],
    excludedQuestionKeys: nextSession.answeredQuestionKeys
  });

  if (remainingSelectableCount > 0) {
    return false;
  }

  console.log(DEBUG_LOG_PREFIX, "session completed early because no more questions are available", {
    sessionId: nextSession.sessionId,
    completedQuestionCount: nextSession.completedQuestionCount,
    requiredQuestionCount: nextSession.requiredQuestionCount
  });

  return nextSession.completedQuestionCount > 0;
}

function appendRecentQuestionHistory(recentQuestionHistory, question) {
  const nextRecentQuestionHistory = Array.isArray(recentQuestionHistory)
    ? [
        ...recentQuestionHistory,
        {
          at: Date.now(),
          listId: question.listId,
          questionId: question.id,
          questionKey: LockBrowserStorage.buildQuestionKey(question.listId, question.id),
          prompt: question.prompt
        }
      ]
    : [
        {
          at: Date.now(),
          listId: question.listId,
          questionId: question.id,
          questionKey: LockBrowserStorage.buildQuestionKey(question.listId, question.id),
          prompt: question.prompt
        }
      ];

  return nextRecentQuestionHistory.slice(-10);
}

async function updateQuestionListEnabled(listId, enabled) {
  const store = await LockBrowserStorage.getDataStore();
  const now = Date.now();
  const currentLists = store[LockBrowserStorage.STORAGE_KEYS.questionLists];
  const nextLists = currentLists.map((list) => {
    if (list.id !== listId) {
      return list;
    }

    if (!enabled) {
      // Keep the learning clock stopped while a list is disabled.
      console.log(DEBUG_LOG_PREFIX, "list disabled", { listId, pausedAt: now });
      return {
        ...list,
        enabled: false,
        pausedAt: now
      };
    }

    return {
      ...list,
      enabled: true,
      pausedAt: null
    };
  });

  const previousList = currentLists.find((list) => list.id === listId);
  const nextEnabledListIds = nextLists.filter((list) => list.enabled).map((list) => list.id);
  let nextProgressByKey = {
    ...store[LockBrowserStorage.STORAGE_KEYS.progressByKey]
  };

  if (enabled && previousList && previousList.pausedAt) {
    const pauseDurationMs = Math.max(0, now - previousList.pausedAt);
    nextProgressByKey = shiftListProgressForPause(
      store[LockBrowserStorage.STORAGE_KEYS.questions],
      nextProgressByKey,
      listId,
      pauseDurationMs
    );
    console.log(DEBUG_LOG_PREFIX, "list re-enabled and reviewAt shifted", {
      listId,
      pauseDurationMs
    });
  }

  await LockBrowserStorage.setDataStore({
    [LockBrowserStorage.STORAGE_KEYS.questionLists]: nextLists,
    [LockBrowserStorage.STORAGE_KEYS.enabledListIds]: nextEnabledListIds,
    [LockBrowserStorage.STORAGE_KEYS.progressByKey]: nextProgressByKey
  });

  return {
    ...store,
    [LockBrowserStorage.STORAGE_KEYS.questionLists]: nextLists,
    [LockBrowserStorage.STORAGE_KEYS.enabledListIds]: nextEnabledListIds,
    [LockBrowserStorage.STORAGE_KEYS.progressByKey]: nextProgressByKey
  };
}

function shiftListProgressForPause(questions, progressByKey, listId, pauseDurationMs) {
  const nextProgressByKey = {
    ...progressByKey
  };

  for (const question of questions) {
    if (question.listId !== listId) {
      continue;
    }

    const progressKey = LockBrowserStorage.buildQuestionKey(question.listId, question.id);
    const currentProgress = progressByKey[progressKey];
    if (!currentProgress) {
      continue;
    }

    // Keep the learning clock stopped while a list is disabled, then shift it on resume.
    // TODO: Revisit the exact overdue behavior after long pauses.
    nextProgressByKey[progressKey] = {
      ...currentProgress,
      reviewAt: LockBrowserProgress.shiftReviewAtForPause(
        currentProgress.reviewAt,
        pauseDurationMs
      )
    };
  }

  return nextProgressByKey;
}

function toPublicQuestion(question, progress) {
  return {
    listId: question.listId,
    id: question.id,
    prompt: question.prompt,
    displayAnswer: question.displayAnswer,
    answerReading: question.answerReading,
    explanation: question.explanation,
    progress
  };
}

async function scheduleRelock(unlockUntil) {
  await chrome.alarms.clear(RELOCK_ALARM_NAME);
  await chrome.alarms.create(RELOCK_ALARM_NAME, {
    when: unlockUntil
  });
}

async function broadcastLockState() {
  const state = await LockBrowserLockState.getLockState();
  const tabs = await chrome.tabs.query({});

  await Promise.all(
    tabs.map(async (tab) => {
      if (typeof tab.id !== "number") {
        return;
      }

      await sendLockStateToTab(tab.id, state);
    })
  );
}

async function sendLockStateToTab(tabId, state) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "LOCK_STATE_CHANGED",
      state
    });
  } catch (error) {
    // Ignore pages where the content script cannot be injected.
  }
}

async function togglePause(lockIntervalMs) {
  const currentState = await LockBrowserLockState.getLockState();

  if (currentState.isPaused) {
    const resumedState = {
      ...LockBrowserLockState.DEFAULT_LOCK_STATE,
      isLocked: true
    };

    await chrome.alarms.clear(RELOCK_ALARM_NAME);
    await LockBrowserLockState.setLockState(resumedState);
    await broadcastLockState();
    return resumedState;
  }

  const pausedState = {
    ...LockBrowserLockState.DEFAULT_LOCK_STATE,
    isLocked: false,
    isPaused: true,
    pausedAt: Date.now(),
    unlockUntil: null
  };

  await chrome.alarms.clear(RELOCK_ALARM_NAME);
  await LockBrowserLockState.setLockState(pausedState);
  await broadcastLockState();
  return pausedState;
}
