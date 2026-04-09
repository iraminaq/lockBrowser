function splitMsToMinutesSeconds(totalMs) {
  const safeMs = Math.max(0, Number(totalMs) || 0);
  const totalSeconds = Math.floor(safeMs / 1000);

  return {
    minutes: Math.floor(totalSeconds / 60),
    seconds: totalSeconds % 60
  };
}

let excludedSites = [];
let saveTimerId = null;
let saveStatusTimerId = null;
let isRenderingSettings = false;

function buildMsFromMinutesSeconds(minutesValue, secondsValue, fallbackMs, minimumMs) {
  const minutes = normalizeNonNegativeInteger(minutesValue, 0);
  const seconds = normalizeNonNegativeInteger(secondsValue, 0);
  const totalSeconds = minutes * 60 + seconds;

  if (totalSeconds <= 0) {
    return Math.max(minimumMs, fallbackMs);
  }

  return Math.max(minimumMs, totalSeconds * 1000);
}

function normalizeNonNegativeInteger(value, fallback) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.max(0, Math.round(numericValue));
}

async function renderSettingsPage() {
  isRenderingSettings = true;
  const settings = await LockBrowserStorage.getSettings();
  const lockInterval = splitMsToMinutesSeconds(settings.lockIntervalMs);
  const incorrectRetryDelay = splitMsToMinutesSeconds(settings.incorrectRetryDelayMs);
  excludedSites = [...settings.excludedSites];

  document.getElementById("lock-interval-minutes").value = String(lockInterval.minutes);
  document.getElementById("lock-interval-seconds").value = String(lockInterval.seconds);
  document.getElementById("questions-per-lock").value = String(settings.questionsPerLock);
  document.getElementById("auto-start-lock-on-browser-open").checked =
    settings.autoStartLockOnBrowserOpen;
  document.getElementById("max-consecutive-unseen").value = String(settings.maxConsecutiveUnseen);
  document.getElementById("same-list-bias-limit").value = String(settings.sameListBiasLimit);
  document.getElementById("answer-input-mode").value = settings.answerInputMode;
  document.getElementById("incorrect-retry-delay-minutes").value = String(
    incorrectRetryDelay.minutes
  );
  document.getElementById("incorrect-retry-delay-seconds").value = String(
    incorrectRetryDelay.seconds
  );
  renderExcludedSites();
  isRenderingSettings = false;
}

async function saveSettingsNow() {
  const nextPatch = normalizeSettingsPatch({
    lockIntervalMs: buildMsFromMinutesSeconds(
      document.getElementById("lock-interval-minutes").value,
      document.getElementById("lock-interval-seconds").value,
      LockBrowserStorage.DEFAULT_SETTINGS.lockIntervalMs,
      LockBrowserStorage.SETTINGS_LIMITS.minLockIntervalMs
    ),
    questionsPerLock: document.getElementById("questions-per-lock").value,
    autoStartLockOnBrowserOpen: document.getElementById("auto-start-lock-on-browser-open").checked,
    maxConsecutiveUnseen: document.getElementById("max-consecutive-unseen").value,
    sameListBiasLimit: document.getElementById("same-list-bias-limit").value,
    answerInputMode: document.getElementById("answer-input-mode").value,
    incorrectRetryDelayMs: buildMsFromMinutesSeconds(
      document.getElementById("incorrect-retry-delay-minutes").value,
      document.getElementById("incorrect-retry-delay-seconds").value,
      LockBrowserStorage.DEFAULT_SETTINGS.incorrectRetryDelayMs,
      0
    ),
    excludedSites
  });

  const nextSettings = await LockBrowserStorage.updateSettings(nextPatch);

  try {
    await chrome.runtime.sendMessage({ type: "SETTINGS_UPDATED" });
  } catch (error) {
    console.warn("Failed to notify background about settings update:", error);
  }

  const lockInterval = splitMsToMinutesSeconds(nextSettings.lockIntervalMs);
  const incorrectRetryDelay = splitMsToMinutesSeconds(nextSettings.incorrectRetryDelayMs);

  document.getElementById("lock-interval-minutes").value = String(lockInterval.minutes);
  document.getElementById("lock-interval-seconds").value = String(lockInterval.seconds);
  document.getElementById("questions-per-lock").value = String(nextSettings.questionsPerLock);
  document.getElementById("auto-start-lock-on-browser-open").checked =
    nextSettings.autoStartLockOnBrowserOpen;
  document.getElementById("max-consecutive-unseen").value = String(nextSettings.maxConsecutiveUnseen);
  document.getElementById("same-list-bias-limit").value = String(nextSettings.sameListBiasLimit);
  document.getElementById("answer-input-mode").value = nextSettings.answerInputMode;
  document.getElementById("incorrect-retry-delay-minutes").value = String(
    incorrectRetryDelay.minutes
  );
  document.getElementById("incorrect-retry-delay-seconds").value = String(
    incorrectRetryDelay.seconds
  );
  excludedSites = [...nextSettings.excludedSites];
  renderExcludedSites();
  showSaveStatus("保存しました");
}

function normalizeSettingsPatch(patch) {
  const limits = LockBrowserStorage.SETTINGS_LIMITS;

  return {
    lockIntervalMs: normalizeIntegerInput(
      patch.lockIntervalMs,
      LockBrowserStorage.DEFAULT_SETTINGS.lockIntervalMs,
      limits.minLockIntervalMs,
      limits.maxLockIntervalMs
    ),
    maxConsecutiveUnseen: normalizeIntegerInput(
      patch.maxConsecutiveUnseen,
      LockBrowserStorage.DEFAULT_SETTINGS.maxConsecutiveUnseen,
      limits.minMaxConsecutiveUnseen,
      limits.maxMaxConsecutiveUnseen
    ),
    sameListBiasLimit: normalizeIntegerInput(
      patch.sameListBiasLimit,
      LockBrowserStorage.DEFAULT_SETTINGS.sameListBiasLimit,
      limits.minSameListBiasLimit,
      limits.maxSameListBiasLimit
    ),
    questionsPerLock: normalizeIntegerInput(
      patch.questionsPerLock,
      LockBrowserStorage.DEFAULT_SETTINGS.questionsPerLock,
      limits.minQuestionsPerLock,
      limits.maxQuestionsPerLock
    ),
    incorrectRetryDelayMs: normalizeIntegerInput(
      patch.incorrectRetryDelayMs,
      LockBrowserStorage.DEFAULT_SETTINGS.incorrectRetryDelayMs,
      limits.minIncorrectRetryDelayMs,
      limits.maxIncorrectRetryDelayMs
    ),
    answerInputMode: patch.answerInputMode === "keyboard" ? "keyboard" : "candidate",
    autoStartLockOnBrowserOpen: Boolean(patch.autoStartLockOnBrowserOpen),
    excludedSites: Array.isArray(patch.excludedSites) ? patch.excludedSites : []
  };
}

function normalizeIntegerInput(value, fallback, min, max) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  const normalizedValue = Math.round(numericValue);
  return Math.min(max, Math.max(min, normalizedValue));
}

function renderExcludedSites() {
  const listElement = document.getElementById("excluded-sites-list");
  if (!listElement) {
    return;
  }

  listElement.replaceChildren();

  if (excludedSites.length === 0) {
    const empty = document.createElement("p");
    empty.className = "site-chip-empty";
    empty.textContent = "登録されているサイトはありません。";
    listElement.append(empty);
    return;
  }

  excludedSites.forEach((site) => {
    const chip = document.createElement("div");
    chip.className = "site-chip";

    const label = document.createElement("span");
    label.textContent = site;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "×";
    removeButton.setAttribute("aria-label", `${site} を削除`);
    removeButton.addEventListener("click", () => {
      excludedSites = excludedSites.filter((entry) => entry !== site);
      renderExcludedSites();
      scheduleSettingsSave();
    });

    chip.append(label, removeButton);
    listElement.append(chip);
  });
}

function handleAddExcludedSite() {
  const input = document.getElementById("excluded-site-input");
  const normalized = LockBrowserStorage.normalizeExcludedSiteEntry(input.value);

  if (!normalized) {
    showSaveStatus("有効なドメインまたは URL を入力してください。");
    return;
  }

  if (!excludedSites.includes(normalized)) {
    excludedSites = [...excludedSites, normalized];
    renderExcludedSites();
  }

  input.value = "";
  scheduleSettingsSave();
}

function scheduleSettingsSave() {
  if (isRenderingSettings) {
    return;
  }

  if (saveTimerId !== null) {
    window.clearTimeout(saveTimerId);
  }

  saveTimerId = window.setTimeout(() => {
    saveTimerId = null;
    void saveSettingsNow();
  }, 200);
}

function showSaveStatus(message) {
  const statusElement = document.getElementById("save-status");
  statusElement.textContent = message;

  if (saveStatusTimerId !== null) {
    window.clearTimeout(saveStatusTimerId);
  }

  saveStatusTimerId = window.setTimeout(() => {
    statusElement.textContent = "";
    saveStatusTimerId = null;
  }, 1800);
}

document.getElementById("settings-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
});

document.getElementById("add-excluded-site-button")?.addEventListener("click", () => {
  handleAddExcludedSite();
});

document.getElementById("excluded-site-input")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    handleAddExcludedSite();
  }
});

[
  "lock-interval-minutes",
  "lock-interval-seconds",
  "questions-per-lock",
  "max-consecutive-unseen",
  "same-list-bias-limit",
  "incorrect-retry-delay-minutes",
  "incorrect-retry-delay-seconds"
].forEach((id) => {
  document.getElementById(id)?.addEventListener("input", () => {
    scheduleSettingsSave();
  });
});

[
  "auto-start-lock-on-browser-open",
  "answer-input-mode"
].forEach((id) => {
  document.getElementById(id)?.addEventListener("change", () => {
    scheduleSettingsSave();
  });
});

void renderSettingsPage();
