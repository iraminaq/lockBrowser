(function () {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const WEEK_MS = 7 * DAY_MS;
  const MINUTE_MS = 60 * 1000;
  const HOUR_MS = 60 * MINUTE_MS;

  function ensureProgress(progress) {
    return {
      ...globalThis.LockBrowserStorage.DEFAULT_PROGRESS,
      ...(progress || {})
    };
  }

  function getRank(progress) {
    const safeProgress = ensureProgress(progress);

    if (safeProgress.isUnseen) {
      return "unseen";
    }

    if (safeProgress.level >= 20) {
      return "mastered";
    }

    if (safeProgress.level >= 4) {
      return "review";
    }

    return "learning";
  }

  function applyCorrectProgress(progress, now) {
    const currentProgress = ensureProgress(progress);
    const nextLevel = currentProgress.level + 1;

    return {
      level: nextLevel,
      isUnseen: false,
      reviewAt: computeNextReviewAt(nextLevel, now)
    };
  }

  function applyIncorrectProgress(progress, now) {
    const currentProgress = ensureProgress(progress);
    const currentRank = getRank(currentProgress);
    let nextLevel = currentProgress.level;

    if (currentRank === "mastered") {
      nextLevel = 19;
    } else if (currentRank === "review") {
      nextLevel = 3;
    } else if (currentRank === "learning") {
      nextLevel = Math.max(1, currentProgress.level - 1);
    } else {
      nextLevel = 1;
    }

    return {
      level: nextLevel,
      isUnseen: false,
      reviewAt: now + 10 * MINUTE_MS
    };
  }

  function computeNextReviewAt(level, now) {
    const rank = getRank({
      level,
      isUnseen: false,
      reviewAt: null
    });

    let baseDelay = HOUR_MS;
    let jitter = 30 * MINUTE_MS;

    if (rank === "learning") {
      baseDelay = 60 * MINUTE_MS * level;
      jitter = 30 * MINUTE_MS;
    } else if (rank === "review") {
      baseDelay = DAY_MS * level;
      jitter = 10 * HOUR_MS;
    } else if (rank === "mastered") {
      baseDelay = WEEK_MS * level;
      jitter = 5 * DAY_MS;
    }

    const randomizedDelay = baseDelay + randomBetween(-jitter, jitter);
    return now + Math.max(5 * MINUTE_MS, randomizedDelay);
  }

  function shiftReviewAtForPause(reviewAt, pauseDurationMs) {
    // TODO: Call this when a disabled list is re-enabled so overdue items do not spike at once.
    // TODO: Revisit how already-overdue items should behave when a paused list is resumed.
    if (typeof reviewAt !== "number" || pauseDurationMs <= 0) {
      return reviewAt;
    }

    return reviewAt + pauseDurationMs;
  }

  function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  globalThis.LockBrowserProgress = {
    ensureProgress,
    getRank,
    applyCorrectProgress,
    applyIncorrectProgress,
    computeNextReviewAt,
    shiftReviewAtForPause
  };
})();
