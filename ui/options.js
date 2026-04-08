const DEBUG_LOG_PREFIX = "[lockBrowser/debug]";

async function renderOptionsPage() {
  const [store, rawSnapshot] = await Promise.all([
    LockBrowserStorage.getDataStore(),
    chrome.storage.local.get(null)
  ]);

  renderSummary(store);
  renderQuestionListsOverview(store);
  renderDebugSections(store, rawSnapshot);
}

function renderSummary(store) {
  const summary = document.getElementById("summary");
  const questionLists = store[LockBrowserStorage.STORAGE_KEYS.questionLists];
  const questions = store[LockBrowserStorage.STORAGE_KEYS.questions];
  const progressByKey = store[LockBrowserStorage.STORAGE_KEYS.progressByKey];

  summary.innerHTML = `
    <div class="summary-item">
      <span class="summary-label">リスト数</span>
      <strong>${questionLists.length}</strong>
    </div>
    <div class="summary-item">
      <span class="summary-label">問題数</span>
      <strong>${questions.length}</strong>
    </div>
    <div class="summary-item">
      <span class="summary-label">進捗件数</span>
      <strong>${Object.keys(progressByKey).length}</strong>
    </div>
  `;
}

function renderQuestionListsOverview(store) {
  const lists = document.getElementById("lists");
  const questionLists = store[LockBrowserStorage.STORAGE_KEYS.questionLists];
  const enabledListIds = new Set(store[LockBrowserStorage.STORAGE_KEYS.enabledListIds]);
  const questions = store[LockBrowserStorage.STORAGE_KEYS.questions];

  lists.replaceChildren();

  questionLists.forEach((list) => {
    const questionCount = questions.filter((question) => question.listId === list.id).length;
    const element = document.createElement("article");
    element.className = "list-card";
    element.innerHTML = `
      <div class="list-card-head">
        <h3>${escapeHtml(list.name)}</h3>
        <span class="status ${enabledListIds.has(list.id) ? "enabled" : "disabled"}">
          ${enabledListIds.has(list.id) ? "Enabled" : "Disabled"}
        </span>
      </div>
      <p class="list-id">${escapeHtml(list.id)}</p>
      <p class="list-description">${escapeHtml(list.description || "No description yet.")}</p>
      <dl class="meta">
        <div>
          <dt>Questions</dt>
          <dd>${questionCount}</dd>
        </div>
        <div>
          <dt>Paused At</dt>
          <dd>${formatTimestamp(list.pausedAt)}</dd>
        </div>
      </dl>
    `;

    lists.append(element);
  });
}

function renderDebugSections(store, rawSnapshot) {
  const questionLists = store[LockBrowserStorage.STORAGE_KEYS.questionLists];
  const enabledListIds = store[LockBrowserStorage.STORAGE_KEYS.enabledListIds];
  const questions = store[LockBrowserStorage.STORAGE_KEYS.questions];
  const progressByKey = store[LockBrowserStorage.STORAGE_KEYS.progressByKey];
  const quizState = store[LockBrowserStorage.STORAGE_KEYS.quizState];
  const lockState = rawSnapshot[LockBrowserStorage.STORAGE_KEYS.lockState] || {
    isLocked: true,
    unlockUntil: null
  };

  renderKeyValueSection(document.getElementById("debug-lock-state"), [
    ["isLocked", String(lockState.isLocked)],
    ["unlockUntil", formatTimestamp(lockState.unlockUntil)],
    ["nextRelockAt", formatTimestamp(lockState.unlockUntil)]
  ]);

  renderKeyValueSection(document.getElementById("debug-session"), [
    ["sessionId", quizState.currentSession?.sessionId || "-"],
    ["questionKey", quizState.currentSession?.questionKey || "-"],
    [
      "hasIncorrectProgressUpdated",
      String(quizState.currentSession?.hasIncorrectProgressUpdated || false)
    ],
    ["isPenaltyActive", String(quizState.currentSession?.isPenaltyActive || false)]
  ]);

  renderQuestionListsDebug(document.getElementById("debug-question-lists"), questionLists);
  renderTagList(document.getElementById("debug-enabled-list-ids"), enabledListIds);
  renderProgressTable(document.getElementById("debug-progress"), questions, progressByKey);
  renderRecentHistory(document.getElementById("debug-history"), quizState.recentQuestionHistory);

  const rawSnapshotElement = document.getElementById("debug-raw-snapshot");
  rawSnapshotElement.textContent = JSON.stringify(rawSnapshot, null, 2);
}

function renderQuestionListsDebug(container, questionLists) {
  if (!questionLists.length) {
    container.innerHTML = '<p class="empty-state">No question lists.</p>';
    return;
  }

  container.innerHTML = questionLists
    .map(
      (list) => `
        <article class="debug-item">
          <strong>${escapeHtml(list.name)}</strong>
          <dl class="debug-kv compact">
            <div><dt>id</dt><dd>${escapeHtml(list.id)}</dd></div>
            <div><dt>enabled</dt><dd>${String(list.enabled)}</dd></div>
            <div><dt>pausedAt</dt><dd>${formatTimestamp(list.pausedAt)}</dd></div>
          </dl>
        </article>
      `
    )
    .join("");
}

function renderTagList(container, values) {
  if (!Array.isArray(values) || values.length === 0) {
    container.innerHTML = '<p class="empty-state">No enabled list IDs.</p>';
    return;
  }

  container.innerHTML = `
    <div class="tag-list">
      ${values.map((value) => `<span class="tag">${escapeHtml(value)}</span>`).join("")}
    </div>
  `;
}

function renderProgressTable(container, questions, progressByKey) {
  const rows = questions.map((question) => {
    const key = LockBrowserStorage.buildQuestionKey(question.listId, question.id);
    const progress = progressByKey[key] || LockBrowserStorage.DEFAULT_PROGRESS;

    return `
      <tr>
        <td>${escapeHtml(question.listId)}</td>
        <td>${escapeHtml(question.id)}</td>
        <td>${escapeHtml(key)}</td>
        <td>${progress.level}</td>
        <td>${String(progress.isUnseen)}</td>
        <td>${formatTimestamp(progress.reviewAt)}</td>
      </tr>
    `;
  });

  container.innerHTML = `
    <div class="table-wrap">
      <table class="debug-table">
        <thead>
          <tr>
            <th>listId</th>
            <th>questionId</th>
            <th>key</th>
            <th>level</th>
            <th>isUnseen</th>
            <th>reviewAt</th>
          </tr>
        </thead>
        <tbody>${rows.join("")}</tbody>
      </table>
    </div>
  `;
}

function renderRecentHistory(container, recentQuestionHistory) {
  if (!Array.isArray(recentQuestionHistory) || recentQuestionHistory.length === 0) {
    container.innerHTML = '<p class="empty-state">No recent question history yet.</p>';
    return;
  }

  const items = recentQuestionHistory
    .slice()
    .reverse()
    .map(
      (item) => `
        <article class="debug-item">
          <strong>${escapeHtml(item.prompt || item.questionKey)}</strong>
          <dl class="debug-kv compact">
            <div><dt>at</dt><dd>${formatTimestamp(item.at)}</dd></div>
            <div><dt>listId</dt><dd>${escapeHtml(item.listId)}</dd></div>
            <div><dt>questionId</dt><dd>${escapeHtml(item.questionId)}</dd></div>
            <div><dt>questionKey</dt><dd>${escapeHtml(item.questionKey)}</dd></div>
          </dl>
        </article>
      `
    )
    .join("");

  container.innerHTML = items;
}

function renderKeyValueSection(container, entries) {
  container.innerHTML = `
    <dl class="debug-kv">
      ${entries
        .map(
          ([key, value]) => `
            <div>
              <dt>${escapeHtml(key)}</dt>
              <dd>${escapeHtml(value)}</dd>
            </div>
          `
        )
        .join("")}
    </dl>
  `;
}

function formatTimestamp(value) {
  if (typeof value !== "number") {
    return "-";
  }

  const date = new Date(value);
  return `${date.toLocaleString()} (${value})`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function handleRefreshClick() {
  console.log(DEBUG_LOG_PREFIX, "refresh debug view");
  await renderOptionsPage();
}

async function handleResetStorageClick() {
  const confirmed = window.confirm(
    "chrome.storage.local を初期化します。現在の progress と状態は消えます。続けますか？"
  );

  if (!confirmed) {
    return;
  }

  await chrome.storage.local.clear();
  await LockBrowserStorage.ensureDataStore();
  await chrome.storage.local.set({
    [LockBrowserStorage.STORAGE_KEYS.lockState]: {
      isLocked: true,
      unlockUntil: null
    }
  });

  console.log(DEBUG_LOG_PREFIX, "storage reset");
  await renderOptionsPage();
}

function bindEvents() {
  document.getElementById("refresh-debug")?.addEventListener("click", () => {
    void handleRefreshClick();
  });

  document.getElementById("reset-storage")?.addEventListener("click", () => {
    void handleResetStorageClick();
  });
}

bindEvents();
void renderOptionsPage();

// TODO: Add a control to force a chosen debug question into the next session.
// TODO: Add progress and question history visualization as a first-class management UI.
// TODO: Add a dedicated storage viewer for richer debug inspection and filtering.
