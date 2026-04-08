async function renderSettingsPage() {
  const settings = await LockBrowserStorage.getSettings();

  document.getElementById("lock-interval-ms").value = String(settings.lockIntervalMs);
  document.getElementById("max-consecutive-unseen").value = String(settings.maxConsecutiveUnseen);
  document.getElementById("same-list-bias-limit").value = String(settings.sameListBiasLimit);
}

async function handleSubmit(event) {
  event.preventDefault();

  const nextSettings = await LockBrowserStorage.updateSettings({
    lockIntervalMs: Number(document.getElementById("lock-interval-ms").value),
    maxConsecutiveUnseen: Number(document.getElementById("max-consecutive-unseen").value),
    sameListBiasLimit: Number(document.getElementById("same-list-bias-limit").value)
  });

  document.getElementById("save-status").textContent =
    `保存しました: ロック間隔 ${Math.round(nextSettings.lockIntervalMs / 1000)}秒`;
}

document.getElementById("settings-form")?.addEventListener("submit", (event) => {
  void handleSubmit(event);
});

void renderSettingsPage();
