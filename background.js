const LOCK_STATE_KEY = "lockState";
const RELOCK_ALARM_NAME = "relock-all-tabs";
const DEFAULT_UNLOCK_DURATION_MS = 60 * 1000;

chrome.runtime.onInstalled.addListener(async () => {
  await setLockState({
    isLocked: true,
    unlockUntil: null
  });

  await broadcastLockState();
});

chrome.runtime.onStartup.addListener(async () => {
  await syncAlarmWithState();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== "complete") {
    return;
  }

  const state = await getLockState();
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

  await setLockState({
    isLocked: true,
    unlockUntil: null
  });

  await broadcastLockState();
});

async function handleMessage(message) {
  switch (message?.type) {
    case "UNLOCK_REQUEST": {
      const unlockUntil = Date.now() + DEFAULT_UNLOCK_DURATION_MS;
      const nextState = {
        isLocked: false,
        unlockUntil
      };

      await setLockState(nextState);
      await scheduleRelock(unlockUntil);
      await broadcastLockState();

      return { ok: true, state: nextState };
    }

    default:
      return { ok: false, error: "Unknown message type." };
  }
}

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

async function scheduleRelock(unlockUntil) {
  await chrome.alarms.clear(RELOCK_ALARM_NAME);
  await chrome.alarms.create(RELOCK_ALARM_NAME, {
    when: unlockUntil
  });
}

async function syncAlarmWithState() {
  const state = await getLockState();

  if (state.isLocked || !state.unlockUntil) {
    await chrome.alarms.clear(RELOCK_ALARM_NAME);
    return;
  }

  if (state.unlockUntil <= Date.now()) {
    await setLockState({
      isLocked: true,
      unlockUntil: null
    });
    await chrome.alarms.clear(RELOCK_ALARM_NAME);
    await broadcastLockState();
    return;
  }

  await scheduleRelock(state.unlockUntil);
}

async function broadcastLockState() {
  const state = await getLockState();
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
