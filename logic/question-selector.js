(function () {
  const DAY_MS = 24 * 60 * 60 * 1000;

  function selectNextQuestion(input) {
    const {
      questionLists,
      enabledListIds,
      questions,
      progressByKey,
      consecutiveUnseenCount,
      recentListIds,
      now
    } = input;

    const enabledSet = new Set(enabledListIds);
    const listById = new Map(questionLists.map((list) => [list.id, list]));
    const due = [];
    const upcoming = [];
    const unseen = [];
    const future = [];

    for (const question of questions) {
      const list = listById.get(question.listId);
      if (!list || !enabledSet.has(list.id) || list.enabled === false) {
        continue;
      }

      const progressKey = globalThis.LockBrowserStorage.buildQuestionKey(question.listId, question.id);
      const progress = globalThis.LockBrowserProgress.ensureProgress(progressByKey[progressKey]);
      const candidate = {
        question,
        list,
        progress,
        progressKey
      };

      if (typeof progress.reviewAt === "number" && progress.reviewAt <= now) {
        due.push(candidate);
        continue;
      }

      if (typeof progress.reviewAt === "number" && progress.reviewAt <= now + DAY_MS) {
        upcoming.push(candidate);
        continue;
      }

      if (progress.isUnseen) {
        unseen.push(candidate);
        continue;
      }

      future.push(candidate);
    }

    due.sort(compareByReviewAtAsc);
    upcoming.sort(compareByReviewAtAsc);
    future.sort(compareByReviewAtAsc);

    let chosen = null;

    if (due.length > 0) {
      chosen = pickCandidateWithListBias(due, recentListIds);
    } else if (upcoming.length > 0) {
      chosen = pickCandidateWithListBias(upcoming, recentListIds);
    } else if (unseen.length > 0 && consecutiveUnseenCount < 2) {
      chosen = pickCandidateWithListBias(unseen, recentListIds);
    } else if (future.length > 0) {
      chosen = pickCandidateWithListBias(future, recentListIds);
    } else if (unseen.length > 0) {
      chosen = pickCandidateWithListBias(unseen, recentListIds);
    }

    if (!chosen) {
      return null;
    }

    return {
      question: chosen.question,
      progress: chosen.progress,
      progressKey: chosen.progressKey,
      list: chosen.list,
      nextConsecutiveUnseenCount: chosen.progress.isUnseen
        ? Math.min(consecutiveUnseenCount + 1, 2)
        : 0
    };
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

  function pickCandidateWithListBias(candidates, recentListIds) {
    if (candidates.length <= 1) {
      return candidates[0] || null;
    }

    const recent = Array.isArray(recentListIds) ? recentListIds.slice(-2) : [];
    const mostRecentListId = recent[recent.length - 1];
    const sameListStreak = recent.length === 2 && recent[0] === recent[1] ? recent[0] : null;

    // Keep room for listId balancing so one enabled list does not monopolize the queue.
    if (sameListStreak) {
      const alternative = candidates.find((candidate) => candidate.question.listId !== sameListStreak);
      if (alternative) {
        return alternative;
      }
    }

    if (mostRecentListId) {
      const alternative = candidates.find((candidate) => candidate.question.listId !== mostRecentListId);
      if (alternative) {
        return alternative;
      }
    }

    return candidates[0];
  }

  globalThis.LockBrowserQuestionSelector = {
    selectNextQuestion
  };

  // TODO: Make listId balancing more sophisticated with weighted history and per-rank caps.
})();
