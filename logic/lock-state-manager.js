(function () {
  const LOCK_STATE_KEY = "lockState";

  async function getLockState() {
    const stored = await chrome.storage.local.get(LOCK_STATE_KEY);
    const state = stored[LOCK_STATE_KEY];

    if (!state) {
      const initialState = {
        isLocked: true,
        unlockUntil: null
      };

      await setLockState(initialState);
      return initialState;
    }

    if (!state.isLocked && state.unlockUntil && state.unlockUntil <= Date.now()) {
      const relockedState = {
        isLocked: true,
        unlockUntil: null
      };

      await setLockState(relockedState);
      return relockedState;
    }

    return state;
  }

  async function setLockState(state) {
    await chrome.storage.local.set({
      [LOCK_STATE_KEY]: state
    });
  }

  async function unlockForDuration(durationMs, onChanged) {
    const unlockUntil = Date.now() + durationMs;
    const nextState = {
      isLocked: false,
      unlockUntil
    };

    await setLockState(nextState);
    await onChanged(nextState, unlockUntil);

    return nextState;
  }

  async function syncAlarmWithState(alarmName, onRelock) {
    const state = await getLockState();

    if (state.isLocked || !state.unlockUntil) {
      await chrome.alarms.clear(alarmName);
      return;
    }

    if (state.unlockUntil <= Date.now()) {
      const relockedState = {
        isLocked: true,
        unlockUntil: null
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
    getLockState,
    setLockState,
    unlockForDuration,
    syncAlarmWithState
  };
})();
