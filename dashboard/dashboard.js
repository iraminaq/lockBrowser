let selectedListId = null;
let editingItemId = null;
let addReadingTouched = false;
let editReadingTouched = false;
let selectedImportFile = null;
let addCardDrafts = [];
let editCardDrafts = [];

async function getQuestionLists() {
  return LockBrowserStorage.getQuestionLists();
}

async function getListById(listId) {
  return LockBrowserStorage.getListById(listId);
}

async function getItemsByListId(listId) {
  return LockBrowserStorage.getItemsByListId(listId);
}

async function getCardsByListId(listId) {
  return LockBrowserStorage.getCardsByListId(listId);
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

async function createList(name) {
  return LockBrowserStorage.createQuestionList({ name });
}

async function saveItem(item) {
  return LockBrowserStorage.upsertQuestion(item);
}

async function renderDashboard() {
  const questionLists = await getQuestionLists();
  syncViewState();
  renderImportModalState();
  await renderListCards(questionLists);
  await renderDetailSection();
}

function syncViewState() {
  document.getElementById("list-view").hidden = Boolean(selectedListId);
  document.getElementById("detail-view").hidden = !selectedListId;
}

async function renderListCards(questionLists) {
  const listGrid = document.getElementById("list-grid");
  listGrid.replaceChildren();

  if (questionLists.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "まだ問題リストがありません。";
    listGrid.append(empty);
    return;
  }

  const cards = await Promise.all(
    questionLists.map(async (list) => {
      const [items, cardsForList, progressSummary] = await Promise.all([
        getItemsByListId(list.id),
        getCardsByListId(list.id),
        getListProgressSummary(list.id)
      ]);

      const card = document.createElement("article");
      card.className = `list-card${list.enabled ? "" : " is-paused"}`;
      card.innerHTML = `
        <div class="list-card-head">
          <div>
            <h3>${escapeHtml(list.name)}</h3>
            <p class="muted">${items.length} item / ${cardsForList.length} card</p>
          </div>
          <span class="status ${list.enabled ? "enabled" : "paused"}">
            ${list.enabled ? "稼働中" : "一時停止中"}
          </span>
        </div>
        <div class="progress-bar" aria-hidden="true">
          <span class="segment unseen" style="width: ${Math.max(0, progressSummary.unseenRate * 100)}%"></span>
          <span class="segment learning" style="width: ${Math.max(0, progressSummary.learningRate * 100)}%"></span>
          <span class="segment review" style="width: ${Math.max(0, progressSummary.reviewRate * 100)}%"></span>
          <span class="segment mastered" style="width: ${Math.max(0, progressSummary.masteredRate * 100)}%"></span>
        </div>
        <p class="progress-text">
          未着手 ${Math.round(progressSummary.unseenRate * 100)}% /
          学習中 ${Math.round(progressSummary.learningRate * 100)}% /
          復習 ${Math.round(progressSummary.reviewRate * 100)}% /
          定着 ${Math.round(progressSummary.masteredRate * 100)}%
        </p>
        <div class="card-actions">
          <button class="secondary-button toggle-list" data-list-id="${escapeHtml(list.id)}" data-enabled="${String(!list.enabled)}">
            ${list.enabled ? "一時停止" : "再開"}
          </button>
          <button class="ghost-button detail-button" data-list-id="${escapeHtml(list.id)}" type="button">詳細</button>
        </div>
      `;

      return card;
    })
  );

  cards.forEach((card) => listGrid.append(card));
  bindListButtons();
}

async function renderDetailSection() {
  if (!selectedListId) {
    return;
  }

  const [list, items, cardsForList, progressSummary] = await Promise.all([
    getListById(selectedListId),
    getItemsByListId(selectedListId),
    getCardsByListId(selectedListId),
    getListProgressSummary(selectedListId)
  ]);

  if (!list) {
    selectedListId = null;
    syncLocation();
    syncViewState();
    return;
  }

  document.getElementById("detail-title").textContent = list.title;
  document.getElementById("detail-summary").innerHTML = `
    <div class="summary-chip"><span>item 数</span><strong>${items.length}</strong></div>
    <div class="summary-chip"><span>card 数</span><strong>${cardsForList.length}</strong></div>
    <div class="summary-chip"><span>未着手</span><strong>${Math.round(progressSummary.unseenRate * 100)}%</strong></div>
    <div class="summary-chip"><span>学習中</span><strong>${Math.round(progressSummary.learningRate * 100)}%</strong></div>
    <div class="summary-chip"><span>復習</span><strong>${Math.round(progressSummary.reviewRate * 100)}%</strong></div>
    <div class="summary-chip"><span>定着</span><strong>${Math.round(progressSummary.masteredRate * 100)}%</strong></div>
  `;

  renderItemList(items);
}

function renderItemList(items) {
  const questionList = document.getElementById("question-list");
  questionList.replaceChildren();

  if (items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "まだ item がありません。";
    questionList.append(empty);
    return;
  }

  items.forEach((item) => {
    const article = document.createElement("article");
    article.className = "question-card";

    const editButton = document.createElement("button");
    editButton.className = "ghost-button edit-question-button";
    editButton.type = "button";
    editButton.textContent = "編集";
    editButton.addEventListener("click", () => {
      editingItemId = item.id;
      void openEditQuestionModal();
    });

    const body = document.createElement("div");
    body.className = "question-card-body";
    const frontText = partsToPlainText(item.fields?.front);
    const backText = partsToPlainText(item.fields?.back);
    const readingText = partsToPlainText(item.fields?.reading);
    const explanationText = partsToPlainText(item.fields?.explanation);
    const cardModes = (item.cards || []).map((card) => card.input?.mode || "keyboard");

    body.innerHTML = `
      <strong class="question-card-prompt">${escapeHtml(frontText || "(empty)")}</strong>
      <p class="muted question-card-answer">${escapeHtml(backText)}${readingText ? ` / ${escapeHtml(readingText)}` : ""}</p>
      ${explanationText ? `<p class="muted question-card-explanation">${escapeHtml(explanationText)}</p>` : ""}
      <p class="muted question-card-explanation">cards: ${escapeHtml(cardModes.join(", ") || "none")}</p>
    `;

    article.append(editButton, body);
    questionList.append(article);
  });
}

function renderImportModalState() {
  const selectedFileElement = document.getElementById("import-selected-file");
  const confirmButton = document.getElementById("confirm-import-button");

  if (selectedImportFile) {
    selectedFileElement.textContent = `選択中: ${selectedImportFile.name}`;
    selectedFileElement.dataset.state = "selected";
    confirmButton.disabled = false;
  } else {
    selectedFileElement.textContent = "選択中のファイルはありません。";
    selectedFileElement.dataset.state = "idle";
    confirmButton.disabled = true;
  }
}

function bindListButtons() {
  document.querySelectorAll(".toggle-list").forEach((button) => {
    button.addEventListener("click", () => {
      void handleToggleClick(button);
    });
  });

  document.querySelectorAll(".detail-button").forEach((button) => {
    button.addEventListener("click", () => {
      selectedListId = button.getAttribute("data-list-id");
      editingItemId = null;
      syncLocation();
      syncViewState();
      void renderDetailSection();
    });
  });
}

async function handleToggleClick(button) {
  const listId = button.getAttribute("data-list-id");
  const enabled = button.getAttribute("data-enabled") === "true";
  await setListEnabled(listId, enabled);
  await renderDashboard();
}

function openModal(modalId) {
  document.getElementById(modalId).hidden = false;
}

function closeModal(modalId) {
  document.getElementById(modalId).hidden = true;
}

async function handleCreateListSubmit(event) {
  event.preventDefault();
  const input = document.getElementById("create-list-name");
  const name = input.value.trim();
  if (!name) {
    return;
  }

  input.value = "";
  await createList(name);
  closeModal("create-list-modal");
  selectedListId = null;
  editingItemId = null;
  setStatus("");
  syncLocation();
  syncViewState();
  await renderDashboard();
}

async function handleSaveAddQuestion(event) {
  event.preventDefault();
  const item = buildItemFromForm("add", selectedListId, null);
  await saveItem(item);
  document.getElementById("add-question-form").reset();
  addReadingTouched = false;
  addCardDrafts = [];
  closeModal("add-question-modal");
  setStatus("");
  await renderDashboard();
}

async function openEditQuestionModal() {
  const items = await getItemsByListId(selectedListId);
  const item = items.find((entry) => entry.id === editingItemId);
  if (!item) {
    return;
  }

  fillFormFromItem("edit", item);
  editReadingTouched = false;
  openModal("edit-question-modal");
}

async function handleSaveEditQuestion(event) {
  event.preventDefault();
  const item = buildItemFromForm("edit", selectedListId, editingItemId);
  await saveItem(item);
  closeModal("edit-question-modal");
  editingItemId = null;
  editReadingTouched = false;
  editCardDrafts = [];
  setStatus("");
  await renderDashboard();
}

function buildItemFromForm(prefix, listId, existingItemId) {
  const frontText = getValue(`${prefix}-question-prompt`);
  const displayAnswer = getValue(`${prefix}-question-display-answer`);
  const reading = getValue(`${prefix}-question-answer-reading`);
  const explanation = getValue(`${prefix}-question-explanation`);
  const tags = getValue(`${prefix}-question-tags`)
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  const itemId = existingItemId || `item-${Date.now().toString(36)}`;
  const cards = readCardEditors(prefix, itemId, displayAnswer, reading);

  return {
    listId,
    id: itemId,
    fields: {
      front: buildParts(
        frontText,
        getValue(`${prefix}-question-front-image`),
        getValue(`${prefix}-question-front-audio`)
      ),
      back: buildParts(
        displayAnswer,
        getValue(`${prefix}-question-back-image`),
        getValue(`${prefix}-question-back-audio`)
      ),
      reading: reading ? [{ type: "text", value: reading }] : [],
      explanation: buildParts(
        explanation,
        getValue(`${prefix}-question-explanation-image`),
        getValue(`${prefix}-question-explanation-audio`)
      )
    },
    tags,
    cards
  };
}

function buildParts(textValue, imageSrc, audioSrc) {
  const parts = [];
  if (textValue) {
    parts.push({ type: "text", value: textValue });
  }
  if (imageSrc) {
    parts.push({ type: "image", src: imageSrc });
  }
  if (audioSrc) {
    parts.push({ type: "audio", src: audioSrc });
  }
  return parts;
}

function createDefaultCardDraft(cardId) {
  return {
    id: cardId || `card-${Date.now().toString(36)}`,
    template: "front-to-back",
    input: { mode: "keyboard" },
    answer: { type: "text", accepted: [], correctChoiceIds: [] },
    choices: []
  };
}

function cloneCardDraft(card) {
  return JSON.parse(JSON.stringify(card));
}

function getCardDrafts(prefix) {
  return prefix === "add" ? addCardDrafts : editCardDrafts;
}

function setCardDrafts(prefix, cards) {
  if (prefix === "add") {
    addCardDrafts = cards;
  } else {
    editCardDrafts = cards;
  }
}

function initializeCardDrafts(prefix, cards) {
  const drafts = Array.isArray(cards) && cards.length > 0
    ? cards.map((card) => cloneCardDraft(card))
    : [createDefaultCardDraft()];
  setCardDrafts(prefix, drafts);
  renderCardEditors(prefix);
}

function renderCardEditors(prefix) {
  const container = document.getElementById(`${prefix}-question-cards`);
  if (!container) {
    return;
  }

  const drafts = getCardDrafts(prefix);
  container.replaceChildren();

  drafts.forEach((card, index) => {
    const article = document.createElement("article");
    article.className = "card-editor-card";
    article.dataset.index = String(index);

    article.innerHTML = `
      <div class="card-editor-card-head">
        <h4>カード ${index + 1}</h4>
        <button class="ghost-button remove-card-button" type="button">削除</button>
      </div>
      <div class="card-editor-grid">
        <label class="field">
          <span>card id</span>
          <input data-card-field="id" value="${escapeHtml(card.id || "")}" />
        </label>
        <label class="field">
          <span>template</span>
          <select data-card-field="template">
            <option value="front-to-back"${card.template === "front-to-back" ? " selected" : ""}>front-to-back</option>
            <option value="front-mcq-back"${card.template === "front-mcq-back" ? " selected" : ""}>front-mcq-back</option>
          </select>
        </label>
        <label class="field">
          <span>input mode</span>
          <select data-card-field="mode">
            <option value="keyboard"${card.input?.mode === "keyboard" ? " selected" : ""}>keyboard</option>
            <option value="candidate"${card.input?.mode === "candidate" ? " selected" : ""}>candidate</option>
            <option value="multiple-choice"${card.input?.mode === "multiple-choice" ? " selected" : ""}>multiple-choice</option>
          </select>
        </label>
        <label class="field">
          <span>answer type</span>
          <input data-card-field="answer-type" value="${escapeHtml(card.answer?.type || "text")}" readonly />
        </label>
        <label class="field" data-card-section="accepted">
          <span>accepted answers (1行に1つ)</span>
          <textarea data-card-field="accepted" rows="3">${escapeHtml(Array.isArray(card.answer?.accepted) ? card.answer.accepted.join("\n") : "")}</textarea>
        </label>
      </div>
      <div class="choice-editor" data-card-section="choices">
        <label class="field"><span>選択肢 1</span><input data-card-field="choice-1" value="${escapeHtml(partsToPlainText(card.choices?.[0]?.parts || []))}" /></label>
        <label class="field"><span>選択肢 2</span><input data-card-field="choice-2" value="${escapeHtml(partsToPlainText(card.choices?.[1]?.parts || []))}" /></label>
        <label class="field"><span>選択肢 3</span><input data-card-field="choice-3" value="${escapeHtml(partsToPlainText(card.choices?.[2]?.parts || []))}" /></label>
        <label class="field"><span>選択肢 4</span><input data-card-field="choice-4" value="${escapeHtml(partsToPlainText(card.choices?.[3]?.parts || []))}" /></label>
        <label class="field">
          <span>正解の選択肢</span>
          <select data-card-field="correct-choice">
            <option value="choice-1"${card.answer?.correctChoiceIds?.[0] === "choice-1" ? " selected" : ""}>1</option>
            <option value="choice-2"${card.answer?.correctChoiceIds?.[0] === "choice-2" ? " selected" : ""}>2</option>
            <option value="choice-3"${card.answer?.correctChoiceIds?.[0] === "choice-3" ? " selected" : ""}>3</option>
            <option value="choice-4"${card.answer?.correctChoiceIds?.[0] === "choice-4" ? " selected" : ""}>4</option>
          </select>
        </label>
      </div>
    `;

    const removeButton = article.querySelector(".remove-card-button");
    removeButton.disabled = drafts.length === 1;
    removeButton.addEventListener("click", () => {
      removeCardDraft(prefix, index);
    });

    const modeSelect = article.querySelector('[data-card-field="mode"]');
    modeSelect.addEventListener("change", () => {
      updateCardEditorVisibility(article);
    });

    updateCardEditorVisibility(article);
    container.append(article);
  });
}

function updateCardEditorVisibility(cardElement) {
  const mode = String(cardElement.querySelector('[data-card-field="mode"]')?.value || "keyboard");
  const answerType = cardElement.querySelector('[data-card-field="answer-type"]');
  const acceptedSection = cardElement.querySelector('[data-card-section="accepted"]');
  const choicesSection = cardElement.querySelector('[data-card-section="choices"]');

  if (answerType) {
    answerType.value = mode === "multiple-choice" ? "choice" : "text";
  }

  if (acceptedSection) {
    acceptedSection.hidden = mode === "multiple-choice";
  }

  if (choicesSection) {
    choicesSection.hidden = mode !== "multiple-choice";
  }
}

function addCardDraft(prefix) {
  const drafts = getCardDrafts(prefix);
  drafts.push(createDefaultCardDraft(`card-${Date.now().toString(36)}`));
  setCardDrafts(prefix, drafts);
  renderCardEditors(prefix);
}

function removeCardDraft(prefix, index) {
  const drafts = getCardDrafts(prefix);
  if (drafts.length <= 1) {
    return;
  }
  drafts.splice(index, 1);
  setCardDrafts(prefix, drafts);
  renderCardEditors(prefix);
}

function readCardEditors(prefix, itemId, displayAnswer, reading) {
  const container = document.getElementById(`${prefix}-question-cards`);
  const editors = Array.from(container.querySelectorAll(".card-editor-card"));
  const cards = editors.map((editor, index) => {
    const mode = getEditorValue(editor, "mode") || "keyboard";
    const cardId = getEditorValue(editor, "id") || `${itemId}-card-${String(index + 1).padStart(3, "0")}`;
    const accepted = getEditorValue(editor, "accepted")
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
    const choices = [1, 2, 3, 4]
      .map((choiceIndex) => {
        const value = getEditorValue(editor, `choice-${choiceIndex}`);
        if (!value) {
          return null;
        }
        return {
          id: `choice-${choiceIndex}`,
          parts: [{ type: "text", value }]
        };
      })
      .filter(Boolean);

    return {
      id: cardId,
      template:
        getEditorValue(editor, "template") ||
        (mode === "multiple-choice" ? "front-mcq-back" : "front-to-back"),
      input: { mode },
      answer:
        mode === "multiple-choice"
          ? {
              type: "choice",
              accepted: [],
              correctChoiceIds: [getEditorValue(editor, "correct-choice") || "choice-1"]
            }
          : {
              type: "text",
              accepted: accepted.length > 0 ? accepted : [reading || displayAnswer].filter(Boolean),
              correctChoiceIds: []
            },
      choices: mode === "multiple-choice" ? choices : []
    };
  });

  return cards.length > 0 ? cards : [createDefaultCardDraft(`${itemId}-card-001`)];
}

function getEditorValue(editor, fieldName) {
  return String(
    editor.querySelector(`[data-card-field="${fieldName}"]`)?.value || ""
  ).trim();
}

function fillFormFromItem(prefix, item) {
  setValue(`${prefix}-question-prompt`, partsToPlainText(item.fields?.front));
  setValue(`${prefix}-question-front-image`, getPartSrc(item.fields?.front, "image"));
  setValue(`${prefix}-question-front-audio`, getPartSrc(item.fields?.front, "audio"));
  setValue(`${prefix}-question-display-answer`, partsToPlainText(item.fields?.back));
  setValue(`${prefix}-question-back-image`, getPartSrc(item.fields?.back, "image"));
  setValue(`${prefix}-question-back-audio`, getPartSrc(item.fields?.back, "audio"));
  setValue(`${prefix}-question-answer-reading`, partsToPlainText(item.fields?.reading));
  setValue(`${prefix}-question-explanation`, partsToPlainText(item.fields?.explanation));
  setValue(`${prefix}-question-explanation-image`, getPartSrc(item.fields?.explanation, "image"));
  setValue(`${prefix}-question-explanation-audio`, getPartSrc(item.fields?.explanation, "audio"));
  setValue(`${prefix}-question-tags`, Array.isArray(item.tags) ? item.tags.join(", ") : "");
  initializeCardDrafts(prefix, item.cards || []);
}

function getPartSrc(parts, type) {
  const found = (Array.isArray(parts) ? parts : []).find((part) => part?.type === type);
  return found?.src || "";
}

function getValue(id) {
  return String(document.getElementById(id)?.value || "").trim();
}

function setValue(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.value = value || "";
  }
}

function openImportPicker() {
  const fileInput = document.getElementById("import-file");
  fileInput.value = "";
  fileInput.click();
}

async function handleImportClick() {
  if (!selectedImportFile) {
    setStatus("先に JSON ファイルを選択してください。");
    return;
  }

  try {
    await LockBrowserDashboardImport.importQuestionListFromFile(selectedImportFile);
    selectedImportFile = null;
    closeModal("import-modal");
    renderImportModalState();
    setStatus("");
    await renderDashboard();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "ファイルの取り込みに失敗しました。");
  }
}

async function handleExportClick() {
  if (!selectedListId) {
    return;
  }

  try {
    const json = await LockBrowserDashboardImport.exportQuestionListAsJson(selectedListId);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selectedListId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "書き出しに失敗しました。");
  }
}

function handleImportFileSelection(file) {
  if (!file) {
    return;
  }

  const isJsonFile =
    file.type === "application/json" ||
    file.type === "application/ld+json" ||
    file.name.toLowerCase().endsWith(".json");

  if (!isJsonFile) {
    selectedImportFile = null;
    renderImportModalState();
    setStatus("JSON ファイルを選択してください。");
    return;
  }

  selectedImportFile = file;
  renderImportModalState();
  setStatus("");
}

function bindImportDropzone() {
  const dropzone = document.getElementById("import-dropzone");

  ["dragenter", "dragover"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.dataset.dragging = "true";
    });
  });

  ["dragleave", "dragend", "drop"].forEach((eventName) => {
    dropzone.addEventListener(eventName, () => {
      dropzone.dataset.dragging = "false";
    });
  });

  dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    handleImportFileSelection(event.dataTransfer?.files?.[0] || null);
  });

  dropzone.addEventListener("click", () => {
    openImportPicker();
  });

  dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openImportPicker();
    }
  });
}

function bindModalDismiss() {
  document.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", () => {
      const modalId = button.getAttribute("data-close-modal");
      closeModal(modalId);
      if (modalId === "import-modal") {
        selectedImportFile = null;
        renderImportModalState();
      }
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    document.querySelectorAll(".modal-shell").forEach((modal) => {
      modal.hidden = true;
    });
    selectedImportFile = null;
    renderImportModalState();
  });
}

function syncLocation() {
  const url = new URL(window.location.href);
  if (selectedListId) {
    url.searchParams.set("listId", selectedListId);
  } else {
    url.searchParams.delete("listId");
  }
  window.history.replaceState({}, "", url);
}

function restoreSelectionFromLocation() {
  const url = new URL(window.location.href);
  selectedListId = url.searchParams.get("listId");
}

function setStatus(message) {
  document.getElementById("dashboard-status").textContent = message;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function partsToPlainText(parts) {
  return globalThis.LockBrowserResolvedCard.partsToPlainText(parts);
}

function bindReadingSuggestion(displayInputId, readingInputId, getTouched, setTouched) {
  const displayInput = document.getElementById(displayInputId);
  const readingInput = document.getElementById(readingInputId);

  displayInput?.addEventListener("input", async () => {
    if (getTouched() && readingInput.value.trim() !== "") {
      return;
    }

    const inferred = await LockBrowserReadingHelper.inferAnswerReading(displayInput.value);
    if (inferred) {
      readingInput.value = inferred;
    }
  });

  readingInput?.addEventListener("input", () => {
    setTouched(readingInput.value.trim() !== "");
  });
}

document.getElementById("create-list-button")?.addEventListener("click", () => {
  document.getElementById("create-list-name").value = "";
  openModal("create-list-modal");
});

document.getElementById("create-list-form")?.addEventListener("submit", (event) => {
  void handleCreateListSubmit(event);
});

document.getElementById("import-list-button")?.addEventListener("click", () => {
  selectedImportFile = null;
  renderImportModalState();
  setStatus("");
  openModal("import-modal");
});

document.getElementById("confirm-import-button")?.addEventListener("click", () => {
  void handleImportClick();
});

document.getElementById("export-list-button")?.addEventListener("click", () => {
  void handleExportClick();
});

document.getElementById("add-question-button")?.addEventListener("click", () => {
  document.getElementById("add-question-form").reset();
  addReadingTouched = false;
  initializeCardDrafts("add", [createDefaultCardDraft()]);
  openModal("add-question-modal");
});

document.getElementById("add-question-card-button")?.addEventListener("click", () => {
  addCardDraft("add");
});

document.getElementById("edit-question-card-button")?.addEventListener("click", () => {
  addCardDraft("edit");
});

document.getElementById("add-question-form")?.addEventListener("submit", (event) => {
  void handleSaveAddQuestion(event);
});

document.getElementById("edit-question-form")?.addEventListener("submit", (event) => {
  void handleSaveEditQuestion(event);
});

document.getElementById("back-to-list")?.addEventListener("click", () => {
  selectedListId = null;
  editingItemId = null;
  syncLocation();
  syncViewState();
  void renderDashboard();
});

document.getElementById("import-file")?.addEventListener("change", (event) => {
  handleImportFileSelection(event.target.files?.[0] || null);
});

bindReadingSuggestion(
  "add-question-display-answer",
  "add-question-answer-reading",
  () => addReadingTouched,
  (value) => {
    addReadingTouched = value;
  }
);

bindReadingSuggestion(
  "edit-question-display-answer",
  "edit-question-answer-reading",
  () => editReadingTouched,
  (value) => {
    editReadingTouched = value;
  }
);

bindImportDropzone();
bindModalDismiss();
restoreSelectionFromLocation();
void renderDashboard();
