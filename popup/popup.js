let currentLockState = null;
let countdownTimerId = null;

async function renderPopup() {
  const storedLockState = await chrome.storage.local.get(LockBrowserStorage.STORAGE_KEYS.lockState);
  currentLockState = storedLockState[LockBrowserStorage.STORAGE_KEYS.lockState] || {
    isLocked: true,
    isPaused: false,
    pausedAt: null,
    unlockUntil: null
  };

  renderLockState();
  syncCountdownTimer();
}

function renderLockState() {
  const statusElement = document.getElementById("lock-status");
  const nextLockElement = document.getElementById("next-lock");
  const pauseButton = document.getElementById("pause-button");
  const statePill = document.getElementById("state-pill");

  if (!currentLockState) {
    return;
  }

  if (currentLockState.isPaused) {
    statusElement.textContent = "状態: 一時停止中";
    nextLockElement.textContent = "ロック進行は停止しています。";
    pauseButton.textContent = "再開";
    statePill.textContent = "一時停止中";
    statePill.dataset.state = "paused";
    return;
  }

  if (
    !currentLockState.isLocked &&
    currentLockState.unlockUntil &&
    currentLockState.unlockUntil <= Date.now()
  ) {
    currentLockState = {
      ...currentLockState,
      isLocked: true,
      unlockUntil: null
    };
  }

  if (currentLockState.isLocked) {
    statusElement.textContent = "状態: ロック中";
    nextLockElement.textContent = "回答画面で問題に答えるか、必要なら解除できます。";
    pauseButton.textContent = "一時停止";
    statePill.textContent = "ロック中";
    statePill.dataset.state = "locked";
    return;
  }

  if (!currentLockState.unlockUntil) {
    statusElement.textContent = "状態: 停止中";
    nextLockElement.textContent = "自動ロックはオフです。";
    pauseButton.textContent = "一時停止";
    statePill.textContent = "停止中";
    statePill.dataset.state = "paused";
    return;
  }

  statusElement.textContent = "状態: 解除中";
  nextLockElement.textContent = `次のロックまで ${formatRemainingTime(currentLockState.unlockUntil)}`;
  pauseButton.textContent = "一時停止";
  statePill.textContent = "解除中";
  statePill.dataset.state = "running";
}

function syncCountdownTimer() {
  clearCountdownTimer();

  if (
    !currentLockState ||
    currentLockState.isPaused ||
    currentLockState.isLocked ||
    !currentLockState.unlockUntil
  ) {
    return;
  }

  countdownTimerId = window.setInterval(() => {
    if (!currentLockState || currentLockState.isPaused || currentLockState.isLocked) {
      clearCountdownTimer();
      return;
    }

    renderLockState();
  }, 1000);
}

function clearCountdownTimer() {
  if (countdownTimerId !== null) {
    window.clearInterval(countdownTimerId);
    countdownTimerId = null;
  }
}

function formatRemainingTime(unlockUntil) {
  const remainingMs = Math.max(0, unlockUntil - Date.now());
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

async function handlePauseClick() {
  const response = await chrome.runtime.sendMessage({ type: "TOGGLE_PAUSE" });
  if (response?.ok) {
    currentLockState = response.state;
    renderLockState();
    syncCountdownTimer();
  }
}

document.getElementById("pause-button")?.addEventListener("click", () => {
  void handlePauseClick();
});

document.getElementById("open-dashboard")?.addEventListener("click", () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("dashboard/dashboard.html") });
});

document.getElementById("open-settings")?.addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[LockBrowserStorage.STORAGE_KEYS.lockState]) {
    return;
  }

  currentLockState = changes[LockBrowserStorage.STORAGE_KEYS.lockState].newValue;
  renderLockState();
  syncCountdownTimer();
});

window.addEventListener("beforeunload", clearCountdownTimer);

void renderPopup();
