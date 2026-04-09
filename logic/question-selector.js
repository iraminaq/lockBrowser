(function () {
  const DAY_MS = 24 * 60 * 60 * 1000;

  function selectNextQuestion(input) {
    const {
      questionLists,
      enabledListIds,
      resolvedCards,
      progressByKey,
      settings,
      consecutiveUnseenCount,
      recentListIds,
      excludedQuestionKeys,
      now
    } = input;

    const enabledSet = new Set(enabledListIds);
    const excludedSet = new Set(Array.isArray(excludedQuestionKeys) ? excludedQuestionKeys : []);
    const listById = new Map(questionLists.map((list) => [list.id, list]));
    const due = [];
    const upcoming = [];
    const unseen = [];
    const future = [];

    for (const resolvedCard of resolvedCards) {
      const list = listById.get(resolvedCard.listId);
      if (!list || !enabledSet.has(list.id) || list.enabled === false) {
        continue;
      }

      const progressKey = globalThis.LockBrowserStorage.createProgressKey(
        resolvedCard.listId,
        resolvedCard.cardId
      );

      if (excludedSet.has(progressKey)) {
        continue;
      }

      const progress = globalThis.LockBrowserProgress.ensureProgress(progressByKey[progressKey]);
      const candidate = {
        resolvedCard,
        list,
        progress,
        progressKey
      };

      if (typeof progress.reviewAt === "number" && progress.reviewAt <= now) {
        due.push(candidate);
        continue;
      }

      if (progress.isUnseen) {
        unseen.push(candidate);
        continue;
      }

      if (typeof progress.reviewAt === "number" && progress.reviewAt <= now + DAY_MS) {
        upcoming.push(candidate);
        continue;
      }

      future.push(candidate);
    }

    due.sort(compareByReviewAtAsc);
    upcoming.sort(compareByReviewAtAsc);
    future.sort(compareByReviewAtAsc);

    let chosen = null;

    if (due.length > 0) {
      chosen = pickCandidateWithListBias(due, recentListIds, settings.sameListBiasLimit);
    } else if (unseen.length > 0 && consecutiveUnseenCount < settings.maxConsecutiveUnseen) {
      chosen = pickCandidateWithListBias(unseen, recentListIds, settings.sameListBiasLimit);
    } else if (upcoming.length > 0) {
      chosen = pickCandidateWithListBias(upcoming, recentListIds, settings.sameListBiasLimit);
    } else if (future.length > 0) {
      chosen = pickCandidateWithListBias(future, recentListIds, settings.sameListBiasLimit);
    } else if (unseen.length > 0) {
      chosen = pickCandidateWithListBias(unseen, recentListIds, settings.sameListBiasLimit);
    }

    if (!chosen) {
      return null;
    }

    return {
      resolvedCard: chosen.resolvedCard,
      progress: chosen.progress,
      progressKey: chosen.progressKey,
      list: chosen.list,
      nextConsecutiveUnseenCount: chosen.progress.isUnseen
        ? Math.min(consecutiveUnseenCount + 1, settings.maxConsecutiveUnseen)
        : 0
    };
  }

  function countSelectableQuestions(input) {
    const {
      questionLists,
      enabledListIds,
      resolvedCards,
      excludedQuestionKeys
    } = input;

    const enabledSet = new Set(enabledListIds);
    const excludedSet = new Set(Array.isArray(excludedQuestionKeys) ? excludedQuestionKeys : []);
    const listById = new Map(questionLists.map((list) => [list.id, list]));

    return resolvedCards.filter((resolvedCard) => {
      const list = listById.get(resolvedCard.listId);
      if (!list || !enabledSet.has(list.id) || list.enabled === false) {
        return false;
      }

      const progressKey = globalThis.LockBrowserStorage.createProgressKey(
        resolvedCard.listId,
        resolvedCard.cardId
      );

      return !excludedSet.has(progressKey);
    }).length;
  }

  function compareByReviewAtAsc(left, right) {
    const leftReviewAt = typeof left.progress.reviewAt === "number"
      ? left.progress.reviewAt
      : Number.MAX_SAFE_INTEGER;
    const rightReviewAt = typeof right.progress.reviewAt === "number"
      ? right.progress.reviewAt
      : Number.MAX_SAFE_INTEGER;

    return leftReviewAt - rightReviewAt;
  }

  function pickCandidateWithListBias(candidates, recentListIds, sameListBiasLimit) {
    if (candidates.length <= 1) {
      return candidates[0] || null;
    }

    const streakWindow = Math.max(1, (sameListBiasLimit || 1) - 1);
    const recent = Array.isArray(recentListIds) ? recentListIds.slice(-streakWindow) : [];
    const mostRecentListId = recent[recent.length - 1];
    const sameListStreak =
      recent.length > 0 && recent.every((listId) => listId === mostRecentListId)
        ? mostRecentListId
        : null;

    if (sameListStreak && recent.length >= streakWindow) {
      const alternative = candidates.find(
        (candidate) => candidate.resolvedCard.listId !== sameListStreak
      );
      if (alternative) {
        return alternative;
      }
    }

    if (mostRecentListId) {
      const alternative = candidates.find(
        (candidate) => candidate.resolvedCard.listId !== mostRecentListId
      );
      if (alternative) {
        return alternative;
      }
    }

    return candidates[0];
  }

  globalThis.LockBrowserQuestionSelector = {
    selectNextQuestion,
    countSelectableQuestions
  };
})();
