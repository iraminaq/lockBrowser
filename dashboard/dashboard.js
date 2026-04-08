async function getQuestionLists() {
  return LockBrowserStorage.getQuestionLists();
}

async function getQuestionsByListId(listId) {
  return LockBrowserStorage.getQuestionsByListId(listId);
}

async function getListProgressSummary(listId) {
  return LockBrowserStorage.getListProgressSummary(listId);
}

async function setListEnabled(listId, enabled) {
  return chrome.runtime.sendMessage({
    type: "SET_LIST_ENABLED",
    listId,
    enabled
  });
}

async function renderDashboard() {
  const listGrid = document.getElementById("list-grid");
  const questionLists = await getQuestionLists();

  listGrid.replaceChildren();

  for (const list of questionLists) {
    const [questions, progressSummary] = await Promise.all([
      getQuestionsByListId(list.id),
      getListProgressSummary(list.id)
    ]);
    const card = document.createElement("article");
    card.className = "list-card";
    card.innerHTML = `
      <div class="list-card-head">
        <div>
          <h3>${escapeHtml(list.name)}</h3>
          <p class="muted">${escapeHtml(list.description || "説明は未設定です。")}</p>
        </div>
        <span class="status ${list.enabled ? "enabled" : "paused"}">
          ${list.enabled ? "有効" : "一時停止中"}
        </span>
      </div>
      <dl class="meta">
        <div>
          <dt>問題数</dt>
          <dd>${questions.length}</dd>
        </div>
        <div>
          <dt>着手率</dt>
          <dd>${Math.round(progressSummary.startedRate * 100)}%</dd>
        </div>
        <div>
          <dt>Paused At</dt>
          <dd>${formatTimestamp(list.pausedAt)}</dd>
        </div>
      </dl>
      <div class="card-actions">
        <button class="secondary-button toggle-list" data-list-id="${escapeHtml(list.id)}" data-enabled="${String(!list.enabled)}">
          ${list.enabled ? "一時停止" : "有効化"}
        </button>
        <button class="ghost-button" type="button" disabled>編集UIは今後追加</button>
      </div>
    `;

    listGrid.append(card);
  }

  bindToggleButtons();
}

function bindToggleButtons() {
  document.querySelectorAll(".toggle-list").forEach((button) => {
    button.addEventListener("click", () => {
      void handleToggleClick(button);
    });
  });
}

async function handleToggleClick(button) {
  const listId = button.getAttribute("data-list-id");
  const enabled = button.getAttribute("data-enabled") === "true";
  await setListEnabled(listId, enabled);
  await renderDashboard();
}

async function handleImportClick() {
  const fileInput = document.getElementById("import-file");
  const statusElement = document.getElementById("import-status");
  const file = fileInput.files?.[0];

  if (!file) {
    statusElement.textContent = "JSON ファイルを選択してください。";
    return;
  }

  const text = await file.text();
  const result = await LockBrowserDashboardImport.importQuestionListFromJsonText(text);
  statusElement.textContent = `${result.list.name} を ${result.importedCount} 問取り込みました。`;
  await renderDashboard();
}

function formatTimestamp(value) {
  if (typeof value !== "number") {
    return "-";
  }

  return new Date(value).toLocaleString();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

document.getElementById("refresh-dashboard")?.addEventListener("click", () => {
  void renderDashboard();
});

document.getElementById("import-button")?.addEventListener("click", () => {
  void handleImportClick();
});

void renderDashboard();
