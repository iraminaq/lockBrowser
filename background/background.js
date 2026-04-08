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
const LOCK_INTERVAL_MS = 5 * 1000; // debug: temporary short relock interval for development
const INCORRECT_RETRY_DELAY_MS = LOCK_INTERVAL_MS + 60 * 1000;

chrome.runtime.onInstalled.addListener(async () => {
  await LockBrowserStorage.ensureDataStore();
  await LockBrowserLockState.setLockState({
    isLocked: true,
    unlockUntil: null
  });
  await broadcastLockState();
});

chrome.runtime.onStartup.addListener(async () => {
  await LockBrowserStorage.ensureDataStore();
  await LockBrowserLockState.syncAlarmWithState(RELOCK_ALARM_NAME, async () => {
    await broadcastLockState();
  });
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
    unlockUntil: null
  });
  await broadcastLockState();
});

async function handleMessage(message) {
  switch (message?.type) {
    case "GET_CURRENT_QUESTION": {
      const question = await getCurrentQuestion();
      return { ok: true, question };
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
      const state = await LockBrowserLockState.unlockForDuration(
        LOCK_INTERVAL_MS,
        async (_, unlockUntil) => {
          await chrome.alarms.clear(RELOCK_ALARM_NAME);
          await chrome.alarms.create(RELOCK_ALARM_NAME, {
            when: unlockUntil
          });
          console.log(
            DEBUG_LOG_PREFIX,
            "next relock scheduled",
            new Date(unlockUntil).toISOString(),
            unlockUntil
          );
          await broadcastLockState();
        }
      );

      console.log(
        LOG_PREFIX,
        "lock released",
        { unlockUntil: state.unlockUntil }
      );

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

    default:
      return { ok: false, error: "Unknown message type." };
  }
}

async function getCurrentQuestion() {
  const store = await LockBrowserStorage.getDataStore();
  const quizState = store[LockBrowserStorage.STORAGE_KEYS.quizState];

  if (quizState.currentQuestionRef) {
    const existing = LockBrowserStorage.findQuestion(
      store,
      quizState.currentQuestionRef.listId,
      quizState.currentQuestionRef.questionId
    );

    if (existing) {
      return toPublicQuestion(
        existing,
        LockBrowserStorage.getProgress(store, existing.listId, existing.id)
      );
    }
  }

  const selected = LockBrowserQuestionSelector.selectNextQuestion({
    questionLists: store[LockBrowserStorage.STORAGE_KEYS.questionLists],
    enabledListIds: store[LockBrowserStorage.STORAGE_KEYS.enabledListIds],
    questions: store[LockBrowserStorage.STORAGE_KEYS.questions],
    progressByKey: store[LockBrowserStorage.STORAGE_KEYS.progressByKey],
    consecutiveUnseenCount: quizState.consecutiveUnseenCount,
    recentListIds: quizState.recentListIds,
    now: Date.now()
  });

  if (!selected) {
    const fallback = store[LockBrowserStorage.STORAGE_KEYS.questions][0];
    return toPublicQuestion(
      fallback,
      LockBrowserStorage.getProgress(store, fallback.listId, fallback.id)
    );
  }

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
      currentSession: createQuestionSession(selected.question)
    }
  });

  console.log(
    DEBUG_LOG_PREFIX,
    "question selected",
    {
      listId: selected.question.listId,
      questionId: selected.question.id,
      progress: selected.progress
    }
  );

  return toPublicQuestion(selected.question, selected.progress);
}

async function submitAnswer(input) {
  const store = await LockBrowserStorage.getDataStore();
  const question = LockBrowserStorage.findQuestion(store, input.listId, input.questionId);

  if (!question) {
    throw new Error("Question not found.");
  }

  const now = Date.now();
  const progressKey = LockBrowserStorage.buildQuestionKey(question.listId, question.id);
  const currentProgress = LockBrowserStorage.getProgress(store, question.listId, question.id);
  const isCorrect = input.answerReading === question.answerReading;
  const currentSession = ensureSession(
    store[LockBrowserStorage.STORAGE_KEYS.quizState].currentSession,
    progressKey
  );
  let nextProgress = currentProgress;
  let nextProgressByKey = {
    ...store[LockBrowserStorage.STORAGE_KEYS.progressByKey]
  };

  if (isCorrect) {
    nextProgress = LockBrowserProgress.applyCorrectProgress(currentProgress, now);
    nextProgressByKey[progressKey] = nextProgress;
    console.log(DEBUG_LOG_PREFIX, "answer correct", {
      questionKey: progressKey,
      nextProgress
    });
  } else if (!currentSession.hasIncorrectProgressUpdated) {
    // Update incorrect progress only once per displayed question session.
    nextProgress = LockBrowserProgress.applyIncorrectProgress(
      currentProgress,
      now,
      getIncorrectReviewDelayMs()
    );
    nextProgressByKey[progressKey] = nextProgress;
    currentSession.hasIncorrectProgressUpdated = true;
    console.log(DEBUG_LOG_PREFIX, "first incorrect progress update applied", {
      questionKey: progressKey,
      nextProgress,
      incorrectReviewDelayMs: getIncorrectReviewDelayMs()
    });
  } else {
    console.log(DEBUG_LOG_PREFIX, "incorrect progress update skipped for current session", {
      questionKey: progressKey,
      sessionId: currentSession.sessionId
    });
  }

  currentSession.isPenaltyActive = !isCorrect;

  await LockBrowserStorage.setDataStore({
    [LockBrowserStorage.STORAGE_KEYS.progressByKey]: nextProgressByKey,
    [LockBrowserStorage.STORAGE_KEYS.quizState]: {
      ...store[LockBrowserStorage.STORAGE_KEYS.quizState],
      currentQuestionRef: isCorrect
        ? null
        : store[LockBrowserStorage.STORAGE_KEYS.quizState].currentQuestionRef,
      currentSession: isCorrect ? null : currentSession
    }
  });

  return {
    listId: question.listId,
    questionId: question.id,
    isCorrect,
    feedback: isCorrect
      ? "\u6b63\u89e3\u3067\u3059\u3002\u78ba\u8a8d\u5f8c\u306b\u30ed\u30c3\u30af\u3092\u89e3\u9664\u3067\u304d\u307e\u3059\u3002"
      : "\u4e0d\u6b63\u89e3\u3067\u3059\u3002\u3082\u3046\u4e00\u5ea6\u8a66\u3057\u3066\u304f\u3060\u3055\u3044\u3002",
    correctAnswer: question.displayAnswer,
    correctReading: question.answerReading,
    progress: nextProgress,
    rank: LockBrowserProgress.getRank(nextProgress)
  };
}

function createQuestionSession(question) {
  return {
    sessionId: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    questionKey: LockBrowserStorage.buildQuestionKey(question.listId, question.id),
    hasIncorrectProgressUpdated: false,
    isPenaltyActive: false
  };
}

function ensureSession(session, questionKey) {
  if (session && session.questionKey === questionKey) {
    return {
      ...session
    };
  }

  return {
    sessionId: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    questionKey,
    hasIncorrectProgressUpdated: false,
    isPenaltyActive: false
  };
}

function appendRecentListId(recentListIds, listId) {
  const nextRecentListIds = Array.isArray(recentListIds) ? [...recentListIds, listId] : [listId];
  return nextRecentListIds.slice(-4);
}

function getIncorrectReviewDelayMs() {
  return INCORRECT_RETRY_DELAY_MS;
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
