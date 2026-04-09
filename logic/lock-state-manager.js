(function () {
  const LOCK_STATE_KEY = "lockState";
  const DEFAULT_LOCK_STATE = {
    isLocked: true,
    isPaused: false,
    pausedAt: null,
    unlockUntil: null
  };

  async function getLockState() {
    const stored = await chrome.storage.local.get(LOCK_STATE_KEY);
    const state = {
      ...DEFAULT_LOCK_STATE,
      ...(stored[LOCK_STATE_KEY] || {})
    };

    if (!stored[LOCK_STATE_KEY]) {
      await setLockState(state);
      return state;
    }

    if (state.isPaused) {
      return state;
    }

    if (!state.isLocked && state.unlockUntil && state.unlockUntil <= Date.now()) {
      const relockedState = {
        ...DEFAULT_LOCK_STATE,
        isLocked: true
      };

      await setLockState(relockedState);
      return relockedState;
    }

    return state;
  }

  async function setLockState(state) {
    await chrome.storage.local.set({
      [LOCK_STATE_KEY]: {
        ...DEFAULT_LOCK_STATE,
        ...(state || {})
      }
    });
  }

  async function unlockForDuration(durationMs, onChanged) {
    const unlockUntil = Date.now() + durationMs;
    const nextState = {
      ...DEFAULT_LOCK_STATE,
      isLocked: false,
      isPaused: false,
      unlockUntil
    };

    await setLockState(nextState);
    await onChanged(nextState, unlockUntil);

    return nextState;
  }

  async function syncAlarmWithState(alarmName, onRelock) {
    const state = await getLockState();

    if (state.isPaused || state.isLocked || !state.unlockUntil) {
      await chrome.alarms.clear(alarmName);
      return;
    }

    if (state.unlockUntil <= Date.now()) {
      const relockedState = {
        ...DEFAULT_LOCK_STATE,
        isLocked: true
      };

      await setLockState(relockedState);
      await chrome.alarms.clear(alarmName);
      await onRelock(relockedState);
      return;
    }

    await chrome.alarms.create(alarmName, {
      when: state.unlockUntil
    });
  }

  globalThis.LockBrowserLockState = {
    DEFAULT_LOCK_STATE,
    getLockState,
    setLockState,
    unlockForDuration,
    syncAlarmWithState
  };
})();
