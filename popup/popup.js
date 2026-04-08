async function renderPopup() {
  const [settings, storedLockState] = await Promise.all([
    LockBrowserStorage.getSettings(),
    chrome.storage.local.get(LockBrowserStorage.STORAGE_KEYS.lockState)
  ]);
  const lockState = storedLockState[LockBrowserStorage.STORAGE_KEYS.lockState] || {
    isLocked: true,
    unlockUntil: null
  };
  const statusElement = document.getElementById("lock-status");
  const nextLockElement = document.getElementById("next-lock");

  if (lockState.isLocked) {
    statusElement.textContent = "現在はロック中です";
    nextLockElement.textContent = `ロック間隔: ${Math.round(settings.lockIntervalMs / 1000)}秒`;
    return;
  }

  const remainingMs = Math.max(0, lockState.unlockUntil - Date.now());
  statusElement.textContent = "現在は解除中です";
  nextLockElement.textContent = `次のロックまで約 ${Math.ceil(remainingMs / 1000)} 秒`;
}

async function handlePauseClick() {
  await chrome.runtime.sendMessage({ type: "UNLOCK_REQUEST" });
  await renderPopup();
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

void renderPopup();
