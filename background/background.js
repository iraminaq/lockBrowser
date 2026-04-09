importScripts(
  "../data/default-data.js",
  "../logic/schema.js",
  "../logic/resolved-card.js",
  "../storage/storage.js",
  "../logic/progress-manager.js",
  "../logic/question-selector.js",
  "../logic/lock-state-manager.js"
);

const RELOCK_ALARM_NAME = "relock-all-tabs";
const LOG_PREFIX = "[lockBrowser]";
const DEBUG_LOG_PREFIX = "[lockBrowser/debug]";
const MIN_PAUSE_SHIFT_MS = 5 * 60 * 1000;

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
    case "GET_CURRENT_CARD":
    // Compatibility alias while older callers move to card-based naming.
    case "GET_CURRENT_QUESTION": {
      const settings = await LockBrowserStorage.getSettings();
      const card = await getCurrentCard(settings);
      return {
        ok: true,
        card,
        question: card,
        answerInputMode: settings.answerInputMode
      };
    }

    case "SUBMIT_ANSWER": {
      const result = await submitAnswer({
        listId: String(message.listId || ""),
        cardId: String(message.cardId || ""),
        answerText: String(message.answerText || "")
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
      const store = await updateListEnabledState(listId, enabled);
      return {
        ok: true,
        listSummaries: store[LockBrowserStorage.STORAGE_KEYS.listSummaries],
        enabledListIds: store[LockBrowserStorage.STORAGE_KEYS.enabledListIds]
      };
    }

    case "REGISTER_INCORRECT_ANSWER": {
      const result = await registerIncorrectAnswer({
        listId: String(message.listId || ""),
        cardId: String(message.cardId || "")
      });
      return { ok: true, ...result };
    }

    case "SETTINGS_UPDATED": {
      const settings = await LockBrowserStorage.getSettings();
      console.log(DEBUG_LOG_PREFIX, "settings updated", {
        lockIntervalMs: settings.lockIntervalMs,
        answerInputMode: settings.answerInputMode,
        incorrectPenaltyMs: settings.incorrectPenaltyMs,
        incorrectReviewDelayMs: settings.incorrectReviewDelayMs
      });
      const state = await applyUpdatedSettings(settings);
      return { ok: true, state, settings };
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

async function getCurrentCard(settings) {
  const store = await LockBrowserStorage.getDataStore();
  const quizState = store[LockBrowserStorage.STORAGE_KEYS.quizState];
  const excludedCardKeys =
    quizState.currentSession?.answeredCardKeys ||
    // Compatibility fallback while older session state keys still exist.
    quizState.currentSession?.answeredQuestionKeys ||
    [];
  const questionData = store[LockBrowserStorage.STORAGE_KEYS.questionData];
  const resolvedCards = globalThis.LockBrowserResolvedCard.getResolvedCards(questionData);

  if (quizState.currentCardRef) {
    const existing = LockBrowserStorage.findResolvedCard(
      store,
      quizState.currentCardRef.listId,
      quizState.currentCardRef.cardId
    );

    if (existing && isCardActive(existing, store)) {
      return toPublicCard(
        existing,
        LockBrowserStorage.getProgress(store, existing.listId, existing.cardId),
        settings
      );
    }

    await LockBrowserStorage.setDataStore({
      [LockBrowserStorage.STORAGE_KEYS.quizState]: {
        ...quizState,
        currentCardRef: null,
        currentSession: null
      }
    });
  }

  const selected = LockBrowserQuestionSelector.selectNextCard({
    listSummaries: store[LockBrowserStorage.STORAGE_KEYS.listSummaries],
    enabledListIds: store[LockBrowserStorage.STORAGE_KEYS.enabledListIds],
    resolvedCards,
    progressByKey: store[LockBrowserStorage.STORAGE_KEYS.progressByKey],
    settings,
    consecutiveUnseenCount: quizState.consecutiveUnseenCount,
    recentListIds: quizState.recentListIds,
    excludedCardKeys,
    now: Date.now()
  });

  if (!selected) {
    await LockBrowserStorage.setDataStore({
      [LockBrowserStorage.STORAGE_KEYS.quizState]: {
        ...quizState,
        currentCardRef: null,
        currentSession: null
      }
    });
    return null;
  }

  const availableCardCount = LockBrowserQuestionSelector.countSelectableCards({
    listSummaries: store[LockBrowserStorage.STORAGE_KEYS.listSummaries],
    enabledListIds: store[LockBrowserStorage.STORAGE_KEYS.enabledListIds],
    resolvedCards,
    excludedCardKeys
  });
  const nextSession = createCardSession(
    selected.resolvedCard,
    quizState.currentSession,
    settings,
    availableCardCount
  );

  await LockBrowserStorage.setDataStore({
    [LockBrowserStorage.STORAGE_KEYS.quizState]: {
      currentCardRef: {
        listId: selected.resolvedCard.listId,
        cardId: selected.resolvedCard.cardId
      },
      consecutiveUnseenCount: selected.nextConsecutiveUnseenCount,
      recentListIds: appendRecentListId(quizState.recentListIds, selected.resolvedCard.listId),
      recentCardHistory: appendRecentCardHistory(
        // Compatibility fallback while older history entries still exist.
        quizState.recentCardHistory || quizState.recentQuestionHistory,
        selected.resolvedCard
      ),
      currentSession: nextSession
    }
  });

  console.log(DEBUG_LOG_PREFIX, "card selected", {
    listId: selected.resolvedCard.listId,
    cardId: selected.resolvedCard.cardId,
    progress: selected.progress,
    sessionId: nextSession.sessionId,
    completedQuestionCount: nextSession.completedQuestionCount,
    requiredQuestionCount: nextSession.requiredQuestionCount
  });

  return toPublicCard(selected.resolvedCard, selected.progress, settings);
}

function isCardActive(card, store) {
  const listSummaries = store[LockBrowserStorage.STORAGE_KEYS.listSummaries];
  const enabledListIds = new Set(store[LockBrowserStorage.STORAGE_KEYS.enabledListIds]);
  const list = listSummaries.find((item) => item.id === card.listId);

  return Boolean(list && list.enabled !== false && enabledListIds.has(list.id));
}

async function submitAnswer(input) {
  const store = await LockBrowserStorage.getDataStore();
  const settings = store[LockBrowserStorage.STORAGE_KEYS.settings];
  const resolvedCard = LockBrowserStorage.findResolvedCard(store, input.listId, input.cardId);

  if (!resolvedCard) {
    throw new Error("Card not found.");
  }

  const now = Date.now();
  const progressKey = LockBrowserStorage.createProgressKey(
    resolvedCard.listId,
    resolvedCard.cardId
  );
  const currentProgress = LockBrowserStorage.getProgress(
    store,
    resolvedCard.listId,
    resolvedCard.cardId
  );
  const quizState = store[LockBrowserStorage.STORAGE_KEYS.quizState];
  const currentSession = ensureSession(quizState.currentSession, progressKey, settings);
  const isCorrect = checkAnswer(resolvedCard, input.answerText);
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
    const answeredCardKeys = appendAnsweredCardKey(
      currentSession.answeredCardKeys,
      progressKey
    );
    nextSession = {
      ...currentSession,
      completedQuestionCount: currentSession.completedQuestionCount + 1,
      answeredCardKeys,
      hasIncorrectProgressUpdated: false,
      isPenaltyActive: false
    };
    console.log(DEBUG_LOG_PREFIX, "answer correct", {
      cardKey: progressKey,
      nextProgress,
      completedQuestionCount: nextSession.completedQuestionCount,
      requiredQuestionCount: nextSession.requiredQuestionCount
    });
  } else {
    const incorrectResult = applyIncorrectAttempt({
      store,
      settings,
      resolvedCard,
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
      currentCardRef: isCorrect ? null : quizState.currentCardRef,
      currentSession: isCorrect
        ? sessionCompleted
          ? null
          : {
              ...nextSession,
              cardKey: null
            }
        : nextSession
    }
  });

  return {
    listId: resolvedCard.listId,
    itemId: resolvedCard.itemId,
    cardId: resolvedCard.cardId,
    isCorrect,
    shouldUnlock: isCorrect && sessionCompleted,
    sessionCompleted,
    completedQuestionCount: isCorrect
      ? nextSession.completedQuestionCount
      : currentSession.completedQuestionCount,
    requiredQuestionCount: currentSession.requiredQuestionCount,
    feedback: isCorrect
      ? sessionCompleted
        ? "正解です。確認後にロックを解除できます。"
        : `正解です。次の問題へ進みます。 (${nextSession.completedQuestionCount}/${nextSession.requiredQuestionCount})`
      : "不正解です。もう一度試してください。",
    correctAnswer: getDisplayValue(resolvedCard),
    correctReading: getCanonicalTextAnswer(resolvedCard),
    progress: nextProgress,
    rank: LockBrowserProgress.getRank(nextProgress)
  };
}

async function registerIncorrectAnswer(input) {
  const store = await LockBrowserStorage.getDataStore();
  const settings = store[LockBrowserStorage.STORAGE_KEYS.settings];
  const resolvedCard = LockBrowserStorage.findResolvedCard(store, input.listId, input.cardId);

  if (!resolvedCard) {
    throw new Error("Card not found.");
  }

  const progressKey = LockBrowserStorage.createProgressKey(
    resolvedCard.listId,
    resolvedCard.cardId
  );
  const currentProgress = LockBrowserStorage.getProgress(
    store,
    resolvedCard.listId,
    resolvedCard.cardId
  );
  const currentSession = ensureSession(
    store[LockBrowserStorage.STORAGE_KEYS.quizState].currentSession,
    progressKey,
    settings
  );

  if (currentProgress.isUnseen) {
    // Unseen cards can be retried immediately without a penalty update.
    currentSession.isPenaltyActive = false;
    await LockBrowserStorage.setDataStore({
      [LockBrowserStorage.STORAGE_KEYS.quizState]: {
        ...store[LockBrowserStorage.STORAGE_KEYS.quizState],
        currentSession
      }
    });

      return {
      shouldStartPenalty: false,
      feedback: "不正解です。初めての問題なので、すぐに再挑戦できます。",
      correctAnswer: getDisplayValue(resolvedCard),
      correctReading: getCanonicalTextAnswer(resolvedCard),
      penaltyDurationMs: getIncorrectPenaltyMs(settings)
    };
  }

  const incorrectResult = applyIncorrectAttempt({
    store,
    settings,
    resolvedCard,
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
    feedback: "不正解です。もう一度試してください。",
    correctAnswer: getDisplayValue(resolvedCard),
    correctReading: getCanonicalTextAnswer(resolvedCard),
    penaltyDurationMs: getIncorrectPenaltyMs(settings)
  };
}

function applyIncorrectAttempt(input) {
  const {
    store,
    settings,
    resolvedCard,
    currentProgress,
    currentSession,
    progressKey,
    now
  } = input;
  const incorrectReviewDelayMs = getIncorrectReviewDelayMs(settings);
  const incorrectPenaltyMs = getIncorrectPenaltyMs(settings);
  let nextProgress = currentProgress;
  let nextProgressByKey = {
    ...store[LockBrowserStorage.STORAGE_KEYS.progressByKey]
  };
  const nextSession = {
    ...currentSession,
    isPenaltyActive: true
  };

  if (!currentSession.hasIncorrectProgressUpdated) {
    // Incorrect progress updates only once per displayed card session.
    nextProgress = LockBrowserProgress.applyIncorrectProgress(
      currentProgress,
      now,
      incorrectReviewDelayMs
    );
    nextProgressByKey[progressKey] = nextProgress;
    nextSession.hasIncorrectProgressUpdated = true;
    console.log(DEBUG_LOG_PREFIX, "first incorrect progress update applied", {
      cardKey: progressKey,
      nextProgress,
      incorrectPenaltyMs,
      incorrectReviewDelayMs
    });
  } else {
    console.log(DEBUG_LOG_PREFIX, "incorrect progress update skipped for current session", {
      cardKey: progressKey,
      sessionId: currentSession.sessionId,
      incorrectPenaltyMs,
      incorrectReviewDelayMs
    });
  }

  return {
    nextProgress,
    nextProgressByKey,
    nextSession,
    incorrectReviewDelayMs
  };
}

function createCardSession(resolvedCard, previousSession, settings, availableCardCount) {
  return {
    sessionId: previousSession?.sessionId || createSessionId(),
    cardKey: LockBrowserStorage.createProgressKey(resolvedCard.listId, resolvedCard.cardId),
    hasIncorrectProgressUpdated: false,
    isPenaltyActive: false,
    completedQuestionCount: normalizeCompletedQuestionCount(previousSession?.completedQuestionCount),
    answeredCardKeys: normalizeAnsweredCardKeys(
      // Compatibility fallback while older session state keys still exist.
      previousSession?.answeredCardKeys || previousSession?.answeredQuestionKeys
    ),
    requiredQuestionCount: normalizeRequiredQuestionCount(
      previousSession?.requiredQuestionCount,
      settings.questionsPerLock,
      availableCardCount
    )
  };
}

function ensureSession(session, cardKey, settings) {
  // Compatibility fallback while older session payloads still carry question-based keys.
  if (session && (session.cardKey === cardKey || session.questionKey === cardKey)) {
    return {
      ...session,
      cardKey: session.cardKey || session.questionKey || cardKey,
      completedQuestionCount: normalizeCompletedQuestionCount(session.completedQuestionCount),
      answeredCardKeys: normalizeAnsweredCardKeys(session.answeredCardKeys || session.answeredQuestionKeys),
      requiredQuestionCount: normalizeRequiredQuestionCount(
        session.requiredQuestionCount,
        settings.questionsPerLock
      )
    };
  }

  return {
    sessionId: createSessionId(),
    cardKey,
    hasIncorrectProgressUpdated: false,
    isPenaltyActive: false,
    completedQuestionCount: 0,
    answeredCardKeys: [],
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

function normalizeAnsweredCardKeys(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function createSessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function appendAnsweredCardKey(answeredCardKeys, cardKey) {
  const nextKeys = normalizeAnsweredCardKeys(answeredCardKeys);
  if (!nextKeys.includes(cardKey)) {
    nextKeys.push(cardKey);
  }

  return nextKeys;
}

function appendRecentListId(recentListIds, listId) {
  const nextRecentListIds = Array.isArray(recentListIds) ? [...recentListIds, listId] : [listId];
  return nextRecentListIds.slice(-4);
}

function getIncorrectReviewDelayMs(settings) {
  return settings.incorrectReviewDelayMs;
}

function getIncorrectPenaltyMs(settings) {
  return settings.incorrectPenaltyMs;
}

function shouldCompleteSessionAfterCorrect(input) {
  const {
    store,
    nextSession
  } = input;

  if (nextSession.completedQuestionCount >= nextSession.requiredQuestionCount) {
    return true;
  }

  const remainingSelectableCount = LockBrowserQuestionSelector.countSelectableCards({
    listSummaries: store[LockBrowserStorage.STORAGE_KEYS.listSummaries],
    enabledListIds: store[LockBrowserStorage.STORAGE_KEYS.enabledListIds],
    resolvedCards: globalThis.LockBrowserResolvedCard.getResolvedCards(
      store[LockBrowserStorage.STORAGE_KEYS.questionData]
    ),
    excludedCardKeys: nextSession.answeredCardKeys
  });

  if (remainingSelectableCount > 0) {
    return false;
  }

  console.log(DEBUG_LOG_PREFIX, "session completed early because no more cards are available", {
    sessionId: nextSession.sessionId,
    completedQuestionCount: nextSession.completedQuestionCount,
    requiredQuestionCount: nextSession.requiredQuestionCount
  });

  return nextSession.completedQuestionCount > 0;
}

function appendRecentCardHistory(recentCardHistory, resolvedCard) {
  const nextRecentCardHistory = Array.isArray(recentCardHistory)
    ? [
        ...recentCardHistory,
        {
          at: Date.now(),
          listId: resolvedCard.listId,
          itemId: resolvedCard.itemId,
          cardId: resolvedCard.cardId,
          cardKey: LockBrowserStorage.createProgressKey(
            resolvedCard.listId,
            resolvedCard.cardId
          ),
          prompt: globalThis.LockBrowserResolvedCard.partsToPlainText(
            resolvedCard.promptParts
          )
        }
      ]
    : [
        {
          at: Date.now(),
          listId: resolvedCard.listId,
          itemId: resolvedCard.itemId,
          cardId: resolvedCard.cardId,
          cardKey: LockBrowserStorage.createProgressKey(
            resolvedCard.listId,
            resolvedCard.cardId
          ),
          prompt: globalThis.LockBrowserResolvedCard.partsToPlainText(
            resolvedCard.promptParts
          )
        }
      ];

  return nextRecentCardHistory.slice(-10);
}

async function updateListEnabledState(listId, enabled) {
  const store = await LockBrowserStorage.getDataStore();
  const now = Date.now();
  const questionData = structuredClone(store[LockBrowserStorage.STORAGE_KEYS.questionData]);
  const currentLists = questionData.lists;
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
    if (pauseDurationMs >= MIN_PAUSE_SHIFT_MS) {
      nextProgressByKey = shiftListProgressForPause(
        store[LockBrowserStorage.STORAGE_KEYS.cardSummaries],
        nextProgressByKey,
        listId,
        pauseDurationMs
      );
      console.log(DEBUG_LOG_PREFIX, "list re-enabled and reviewAt shifted", {
        listId,
        pauseDurationMs
      });
    } else {
      console.log(DEBUG_LOG_PREFIX, "list re-enabled without reviewAt shift", {
        listId,
        pauseDurationMs,
        minPauseShiftMs: MIN_PAUSE_SHIFT_MS
      });
    }
  }

  questionData.lists = nextLists;
  await LockBrowserStorage.setDataStore({
    [LockBrowserStorage.STORAGE_KEYS.questionData]: questionData,
    [LockBrowserStorage.STORAGE_KEYS.enabledListIds]: nextEnabledListIds,
    [LockBrowserStorage.STORAGE_KEYS.progressByKey]: nextProgressByKey
  });

  return LockBrowserStorage.getDataStore();
}

function shiftListProgressForPause(cardSummaries, progressByKey, listId, pauseDurationMs) {
  const nextProgressByKey = {
    ...progressByKey
  };

  for (const cardSummary of cardSummaries) {
    if (cardSummary.listId !== listId) {
      continue;
    }

    const progressKey = LockBrowserStorage.createProgressKey(cardSummary.listId, cardSummary.id);
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

function toPublicCard(resolvedCard, progress, settings) {
  return {
    listId: resolvedCard.listId,
    itemId: resolvedCard.itemId,
    cardId: resolvedCard.cardId,
    template: resolvedCard.template,
    fields: resolvedCard.fields,
    promptParts: resolvedCard.promptParts,
    explanationParts: resolvedCard.explanationParts,
    answer: resolvedCard.answer,
    choices: resolvedCard.choices,
    inputMode: resolvedCard.inputMode || settings.answerInputMode || "keyboard",
    canonicalAnswer: getCanonicalTextAnswer(resolvedCard),
    displayAnswer: getDisplayValue(resolvedCard),
    progress,
    tags: resolvedCard.tags
  };
}

function getDisplayValue(resolvedCard) {
  return globalThis.LockBrowserResolvedCard.partsToPlainText(resolvedCard.fields?.back);
}

function getCanonicalTextAnswer(resolvedCard) {
  return globalThis.LockBrowserResolvedCard.getCanonicalTextAnswer(
    { answer: resolvedCard.answer },
    { fields: resolvedCard.fields }
  );
}

function normalizeAnswerText(value) {
  return String(value || "").trim();
}

function checkAnswer(resolvedCard, userResponse) {
  if (resolvedCard?.answer?.type === "choice") {
    const choiceId = normalizeAnswerText(userResponse);
    const correctChoiceIds = Array.isArray(resolvedCard.answer.correctChoiceIds)
      ? resolvedCard.answer.correctChoiceIds
      : [];
    return correctChoiceIds.includes(choiceId);
  }

  if (resolvedCard?.answer?.type !== "text") {
    return false;
  }

  const normalizedResponse = normalizeAnswerText(userResponse);
  if (!normalizedResponse) {
    return false;
  }

  const accepted = Array.isArray(resolvedCard.answer.accepted)
    ? resolvedCard.answer.accepted
    : [];

  return accepted.some(
    (candidate) => normalizeAnswerText(candidate) === normalizedResponse
  );
}

async function scheduleRelock(unlockUntil) {
  await chrome.alarms.clear(RELOCK_ALARM_NAME);
  await chrome.alarms.create(RELOCK_ALARM_NAME, {
    when: unlockUntil
  });
}

async function applyUpdatedSettings(settings) {
  const currentState = await LockBrowserLockState.getLockState();
  console.log(DEBUG_LOG_PREFIX, "applying settings to lock state", {
    isLocked: currentState.isLocked,
    isPaused: currentState.isPaused,
    unlockUntil: currentState.unlockUntil,
    lockIntervalMs: settings.lockIntervalMs,
    answerInputMode: settings.answerInputMode
  });

  if (currentState.isPaused) {
    await broadcastLockState();
    return currentState;
  }

  if (!currentState.isLocked && currentState.unlockUntil) {
    const nextUnlockUntil = Date.now() + settings.lockIntervalMs;
    const nextState = {
      ...currentState,
      unlockUntil: nextUnlockUntil
    };

    await LockBrowserLockState.setLockState(nextState);
    await scheduleRelock(nextUnlockUntil);
    await broadcastLockState();
    return nextState;
  }

  await broadcastLockState();
  return currentState;
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






