const OVERLAY_ID = "study-gate-lock-overlay";
const LOCK_STATE_KEY = "lockState";
const SETTINGS_KEY = "settings";

const HIRAGANA_CHAR_POOL =
  "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん".split("");
const KATAKANA_CHAR_POOL =
  "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン".split("");
const LOWER_ALPHA_CHAR_POOL = "abcdefghijklmnopqrstuvwxyz".split("");
const UPPER_ALPHA_CHAR_POOL = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const DIGIT_CHAR_POOL = "0123456789".split("");

let overlayElement = null;
let titleElement = null;
let questionPromptElement = null;
let explanationElement = null;
let answerDisplayElement = null;
let answerInputAreaElement = null;
let feedbackElement = null;
let answerRevealElement = null;
let resetButtonElement = null;
let actionButtonElement = null;
let keyboardInputElement = null;

let currentQuestion = null;
let currentQuestionKey = null;
let currentInput = "";
let currentAnswerInputMode = "candidate";
let currentChoices = [];
let currentPenaltySeconds = 0;
let penaltyTimerId = null;
let isSubmittingAnswer = false;
let resultState = "answering";

initialize();

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "LOCK_STATE_CHANGED") {
    return;
  }

  void applyLockStateAsync(message.state);
});

async function initialize() {
  try {
    const state = await getInitialLockState();
    await applyLockStateAsync(state);
  } catch (error) {
    console.error("Failed to initialize lock overlay:", error);
  }
}

async function getInitialLockState() {
  const stored = await chrome.storage.local.get(LOCK_STATE_KEY);
  const state = stored[LOCK_STATE_KEY];

  if (!state) {
    return {
      isLocked: true,
      unlockUntil: null
    };
  }

  if (!state.isLocked && state.unlockUntil && state.unlockUntil <= Date.now()) {
    return {
      isLocked: true,
      unlockUntil: null
    };
  }

  return state;
}

function ensureOverlay() {
  if (overlayElement?.isConnected) {
    return overlayElement;
  }

  const existing = document.getElementById(OVERLAY_ID);
  if (existing) {
    overlayElement = existing;
    return overlayElement;
  }

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.hidden = true;

  const panel = document.createElement("div");
  panel.className = "study-gate-panel";

  const title = document.createElement("h1");
  title.className = "study-gate-title";
  title.textContent = "ロック中";

  const prompt = document.createElement("div");
  prompt.className = "study-gate-question";

  const explanation = document.createElement("div");
  explanation.className = "study-gate-description";
  explanation.hidden = true;

  const answerDisplay = document.createElement("div");
  answerDisplay.className = "study-gate-answer-display";

  const inputArea = document.createElement("div");
  inputArea.className = "study-gate-input-area";

  const feedback = document.createElement("p");
  feedback.className = "study-gate-feedback";
  feedback.hidden = true;

  const answerReveal = document.createElement("p");
  answerReveal.className = "study-gate-answer-reveal";
  answerReveal.hidden = true;

  const resetButton = document.createElement("button");
  resetButton.className = "study-gate-reset-button";
  resetButton.type = "button";
  resetButton.hidden = true;
  resetButton.textContent = "再挑戦";
  resetButton.addEventListener("click", () => {
    resetQuizProgress();
  });

  const actionButton = document.createElement("button");
  actionButton.className = "study-gate-action-button";
  actionButton.type = "button";
  actionButton.hidden = true;
  actionButton.textContent = "ロックを解除";
  actionButton.addEventListener("click", () => {
    void handleUnlockButtonClick();
  });

  panel.append(
    title,
    prompt,
    explanation,
    answerDisplay,
    inputArea,
    feedback,
    answerReveal,
    resetButton,
    actionButton
  );
  overlay.append(panel);

  const root = document.documentElement || document.body;
  if (root) {
    root.append(overlay);
  }

  overlayElement = overlay;
  titleElement = title;
  questionPromptElement = prompt;
  explanationElement = explanation;
  answerDisplayElement = answerDisplay;
  answerInputAreaElement = inputArea;
  feedbackElement = feedback;
  answerRevealElement = answerReveal;
  resetButtonElement = resetButton;
  actionButtonElement = actionButton;
  keyboardInputElement = null;

  return overlayElement;
}

async function applyLockStateAsync(state) {
  if (state?.isLocked) {
    await showOverlay();
    return;
  }

  hideOverlay();
}

async function showOverlay() {
  if (await isCurrentPageExcluded()) {
    hideOverlay();
    return;
  }

  const overlay = ensureOverlay();
  attachOverlayIfNeeded(overlay);

  const previousQuestionKey = currentQuestionKey;
  const nextQuestion = await loadCurrentQuestion();

  if (!nextQuestion) {
    showEmptyState();
  } else if (previousQuestionKey !== getQuestionKey(nextQuestion)) {
    resetQuizProgress();
  } else {
    renderQuestion();
  }

  overlay.hidden = false;
}

function hideOverlay() {
  if (!overlayElement) {
    return;
  }

  clearPenaltyCountdown();
  overlayElement.hidden = true;
  currentQuestion = null;
  currentQuestionKey = null;
  currentInput = "";
  currentChoices = [];
  currentPenaltySeconds = 0;
  isSubmittingAnswer = false;
  resultState = "answering";
  setFeedback("");
  setAnswerReveal("");
}

function attachOverlayIfNeeded(overlay) {
  if (overlay.isConnected) {
    return;
  }

  const root = document.documentElement || document.body;
  if (root) {
    root.append(overlay);
  }
}

async function loadCurrentQuestion() {
  const response = await chrome.runtime.sendMessage({ type: "GET_CURRENT_QUESTION" });
  if (!response?.ok) {
    throw new Error("Quiz question is unavailable.");
  }

  currentQuestion = response.question || null;
  currentQuestionKey = currentQuestion ? getQuestionKey(currentQuestion) : null;
  currentAnswerInputMode = currentQuestion?.inputMode || response.answerInputMode || "keyboard";

  return currentQuestion;
}

async function isCurrentPageExcluded() {
  const hostname = getCurrentHostname();
  if (!hostname) {
    return false;
  }

  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const settings = stored[SETTINGS_KEY] || {};
  const excludedSites = Array.isArray(settings.excludedSites) ? settings.excludedSites : [];

  return excludedSites.some((rule) => {
    const normalizedRule = String(rule || "").trim().toLowerCase();
    return normalizedRule && (hostname === normalizedRule || hostname.endsWith(`.${normalizedRule}`));
  });
}

function getCurrentHostname() {
  try {
    return window.location.hostname.toLowerCase();
  } catch (error) {
    return "";
  }
}

function resetQuizProgress() {
  clearPenaltyCountdown();
  currentInput = "";
  currentChoices = createChoicesForCurrentStep();
  currentPenaltySeconds = 0;
  isSubmittingAnswer = false;
  resultState = "answering";
  setFeedback("");
  setAnswerReveal("");

  if (resetButtonElement) {
    resetButtonElement.hidden = true;
    resetButtonElement.disabled = false;
  }

  if (actionButtonElement) {
    actionButtonElement.hidden = true;
    actionButtonElement.disabled = false;
    actionButtonElement.textContent = "ロックを解除";
  }

  renderQuestion();
}

function showEmptyState() {
  clearPenaltyCountdown();
  currentInput = "";
  currentChoices = [];
  currentPenaltySeconds = 0;
  resultState = "empty";
  isSubmittingAnswer = false;

  if (titleElement) {
    titleElement.textContent = "ロック中";
  }

  renderParts(questionPromptElement, [
    { type: "text", value: "出題できる問題がありません。" }
  ]);
  renderParts(explanationElement, []);

  if (answerDisplayElement) {
    answerDisplayElement.textContent = "";
    answerDisplayElement.dataset.completed = "false";
    answerDisplayElement.dataset.locked = "true";
  }

  if (answerInputAreaElement) {
    answerInputAreaElement.replaceChildren();
    answerInputAreaElement.hidden = true;
  }

  setFeedback("問題リストやカード設定を確認してください。", "error");
  setAnswerReveal("");

  if (resetButtonElement) {
    resetButtonElement.hidden = true;
  }

  if (actionButtonElement) {
    actionButtonElement.hidden = false;
    actionButtonElement.disabled = false;
    actionButtonElement.textContent = "ロックを解除";
  }
}

function renderQuestion() {
  if (!currentQuestion || !questionPromptElement || !answerDisplayElement) {
    return;
  }

  if (titleElement) {
    titleElement.textContent = "ロック中";
  }

  renderParts(questionPromptElement, currentQuestion.promptParts || []);
  renderParts(explanationElement, currentQuestion.explanationParts || []);

  answerDisplayElement.textContent = currentInput;
  answerDisplayElement.dataset.completed = String(resultState === "success");
  answerDisplayElement.dataset.locked = String(isInputLocked());

  renderAnswerInputArea();

  if (resetButtonElement) {
    resetButtonElement.hidden = resultState !== "retry-ready";
    resetButtonElement.disabled = isSubmittingAnswer;
  }
}

function renderParts(container, parts) {
  if (!container) {
    return;
  }

  container.replaceChildren();
  const safeParts = Array.isArray(parts) ? parts : [];

  safeParts.forEach((part) => {
    const node = renderPart(part);
    if (node) {
      container.append(node);
    }
  });

  container.hidden = safeParts.length === 0;
}

function renderPart(part) {
  if (!part || typeof part !== "object") {
    return null;
  }

  if (part.type === "text") {
    return renderTextPart(part);
  }

  if (part.type === "image") {
    return renderImagePart(part);
  }

  if (part.type === "audio") {
    return renderAudioPart(part);
  }

  return null;
}

function renderTextPart(part) {
  const span = document.createElement("span");
  span.textContent = String(part.value || "");
  return span;
}

function renderImagePart(part) {
  const src = String(part.src || "").trim();
  if (!src) {
    return null;
  }

  const image = document.createElement("img");
  image.src = src;
  image.alt = "";
  image.style.maxWidth = "100%";
  image.style.borderRadius = "12px";
  image.style.marginTop = "8px";
  return image;
}

function renderAudioPart(part) {
  const src = String(part.src || "").trim();
  if (!src) {
    return null;
  }

  const audio = document.createElement("audio");
  audio.controls = true;
  audio.src = src;
  audio.style.width = "100%";
  audio.style.marginTop = "8px";
  return audio;
}

function renderAnswerInputArea() {
  if (!answerInputAreaElement) {
    return;
  }

  answerInputAreaElement.replaceChildren();
  keyboardInputElement = null;

  if (resultState !== "answering") {
    answerInputAreaElement.hidden = true;
    return;
  }

  answerInputAreaElement.hidden = false;

  if (getEffectiveInputMode() === "keyboard") {
    renderKeyboardControls();
  } else if (getEffectiveInputMode() === "multiple-choice") {
    renderMultipleChoiceControls();
  } else {
    renderCandidateChoices();
  }
}

function renderKeyboardControls() {
  const wrapper = document.createElement("div");
  wrapper.className = "study-gate-keyboard";

  const input = document.createElement("input");
  input.className = "study-gate-keyboard-input";
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = "答えを入力";
  input.disabled = isInputLocked();
  input.value = currentInput;
  input.addEventListener("input", () => {
    currentInput = input.value;
    updateAnswerDisplay();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void handleKeyboardSubmit();
    }
  });

  const submitButton = document.createElement("button");
  submitButton.className = "study-gate-keyboard-submit";
  submitButton.type = "button";
  submitButton.textContent = "決定";
  submitButton.disabled = isInputLocked();
  submitButton.addEventListener("click", () => {
    void handleKeyboardSubmit();
  });

  wrapper.append(input, submitButton);
  answerInputAreaElement.append(wrapper);
  keyboardInputElement = input;
}

function renderCandidateChoices() {
  const choices = document.createElement("div");
  choices.className = "study-gate-choices";

  currentChoices.forEach((choice) => {
    const button = document.createElement("button");
    button.className = "study-gate-choice-button";
    button.type = "button";
    button.textContent = choice;
    button.disabled = isInputLocked();
    button.addEventListener("click", () => {
      void handleCharacterClick(choice);
    });
    choices.append(button);
  });

  answerInputAreaElement.append(choices);
}

function renderMultipleChoiceControls() {
  const choices = document.createElement("div");
  choices.className = "study-gate-choices";

  (currentQuestion?.choices || []).forEach((choice) => {
    const button = document.createElement("button");
    button.className = "study-gate-choice-button";
    button.type = "button";
    button.disabled = isInputLocked();
    renderPartsIntoButton(button, choice.parts || []);
    button.addEventListener("click", () => {
      void handleChoiceSubmit(choice.id);
    });
    choices.append(button);
  });

  answerInputAreaElement.append(choices);
}

function renderPartsIntoButton(button, parts) {
  button.replaceChildren();
  (Array.isArray(parts) ? parts : []).forEach((part) => {
    const node = renderPart(part);
    if (node) {
      button.append(node);
    }
  });
}

function getEffectiveInputMode() {
  if (currentAnswerInputMode === "multiple-choice") {
    return "multiple-choice";
  }

  if (currentAnswerInputMode === "candidate" && getCanonicalAnswer()) {
    return "candidate";
  }

  return "keyboard";
}

function createChoicesForCurrentStep() {
  if (!currentQuestion || getEffectiveInputMode() !== "candidate") {
    return [];
  }

  const canonicalAnswer = getCanonicalAnswer();
  const nextChar = canonicalAnswer[currentInput.length];
  if (!nextChar) {
    return [];
  }

  const uniqueChoices = new Set([nextChar]);
  const dummyCharPool = getDummyCharPool(canonicalAnswer, nextChar);

  while (uniqueChoices.size < 4 && dummyCharPool.length > 0) {
    const dummyChar = dummyCharPool[Math.floor(Math.random() * dummyCharPool.length)];
    if (!canonicalAnswer.includes(dummyChar) && !uniqueChoices.has(dummyChar)) {
      uniqueChoices.add(dummyChar);
    }
  }

  return shuffle(Array.from(uniqueChoices));
}

async function handleChoiceSubmit(choiceId) {
  if (!currentQuestion || isInputLocked()) {
    return;
  }

  currentInput = String(choiceId || "");
  await submitCurrentAnswer();
}

function getDummyCharPool(answerText, nextChar) {
  const kind = detectCharacterKind(answerText, nextChar);

  if (kind === "alpha-lower") {
    return LOWER_ALPHA_CHAR_POOL;
  }

  if (kind === "alpha-upper") {
    return UPPER_ALPHA_CHAR_POOL;
  }

  if (kind === "alpha-mixed") {
    return [...LOWER_ALPHA_CHAR_POOL, ...UPPER_ALPHA_CHAR_POOL];
  }

  if (kind === "digit") {
    return DIGIT_CHAR_POOL;
  }

  if (kind === "katakana") {
    return KATAKANA_CHAR_POOL;
  }

  return HIRAGANA_CHAR_POOL;
}

function detectCharacterKind(answerText, nextChar) {
  const text = String(answerText || "");

  if (/^[A-Z]+$/.test(text)) {
    return "alpha-upper";
  }

  if (/^[a-z]+$/.test(text)) {
    return "alpha-lower";
  }

  if (/^[A-Za-z]+$/.test(text)) {
    if (/[A-Z]/.test(nextChar || "")) {
      return "alpha-upper";
    }

    if (/[a-z]/.test(nextChar || "")) {
      return "alpha-lower";
    }

    return "alpha-mixed";
  }

  if (/^[0-9]+$/.test(text)) {
    return "digit";
  }

  if (/^[ァ-ヶー]+$/.test(text)) {
    return "katakana";
  }

  return "hiragana";
}

function shuffle(items) {
  const result = [...items];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
}

function setFeedback(message, tone = "") {
  if (!feedbackElement) {
    return;
  }

  feedbackElement.textContent = message;
  feedbackElement.dataset.tone = tone;
  feedbackElement.hidden = !message;
}

function setAnswerReveal(message) {
  if (!answerRevealElement) {
    return;
  }

  answerRevealElement.textContent = message;
  answerRevealElement.hidden = !message;
}

function buildAnswerRevealMessage(correctAnswer, correctReading) {
  if (!correctAnswer) {
    return "";
  }

  if (correctReading && correctReading !== correctAnswer) {
    return `正解: ${correctAnswer} (${correctReading})`;
  }

  return `正解: ${correctAnswer}`;
}

function getQuestionKey(question) {
  return `${question.listId}:${question.cardId}`;
}

function getCanonicalAnswer() {
  const answer = currentQuestion?.answer;
  if (!answer || answer.type !== "text") {
    return "";
  }

  if (Array.isArray(answer.accepted) && answer.accepted.length > 0) {
    return String(answer.accepted[0] || "");
  }

  return String(currentQuestion.canonicalAnswer || "");
}

function getDisplayAnswer() {
  return String(currentQuestion?.displayAnswer || "");
}

function isInputLocked() {
  return isSubmittingAnswer || resultState !== "answering";
}

function startPenaltyCountdown(durationSeconds) {
  clearPenaltyCountdown();
  currentPenaltySeconds = Math.max(1, Math.ceil(Number(durationSeconds) || 1));
  currentInput = "";
  currentChoices = [];
  resultState = "incorrect-feedback";
  renderQuestion();
  updatePenaltyFeedback();

  penaltyTimerId = window.setInterval(() => {
    currentPenaltySeconds -= 1;

    if (currentPenaltySeconds <= 0) {
      clearPenaltyCountdown();
      showRetryReadyState();
      return;
    }

    updatePenaltyFeedback();
  }, 1000);
}

function clearPenaltyCountdown() {
  if (penaltyTimerId !== null) {
    window.clearInterval(penaltyTimerId);
    penaltyTimerId = null;
  }

  currentPenaltySeconds = 0;
}

function showRetryReadyState() {
  resultState = "retry-ready";
  currentInput = "";
  currentChoices = [];
  renderQuestion();
  setFeedback("再挑戦できます。", "error");

  if (resetButtonElement) {
    resetButtonElement.hidden = false;
    resetButtonElement.disabled = false;
    resetButtonElement.textContent = "再挑戦";
  }
}

function updatePenaltyFeedback() {
  setFeedback(`不正解です。再挑戦まで ${currentPenaltySeconds} 秒`, "error");
  setAnswerReveal(buildAnswerRevealMessage(getDisplayAnswer(), getCanonicalAnswer()));
}

async function handleCharacterClick(character) {
  if (!currentQuestion || isInputLocked()) {
    return;
  }

  const canonicalAnswer = getCanonicalAnswer();
  currentInput += character;
  updateAnswerDisplay();

  if (!canonicalAnswer.startsWith(currentInput)) {
    await handleIncorrectAttempt();
    return;
  }

  if (currentInput === canonicalAnswer) {
    await submitCurrentAnswer();
    return;
  }

  currentChoices = createChoicesForCurrentStep();
  renderQuestion();
}

async function handleKeyboardSubmit() {
  if (!currentQuestion || isInputLocked()) {
    return;
  }

  currentInput = String(keyboardInputElement?.value || "").trim();
  updateAnswerDisplay();

  if (!currentInput) {
    setFeedback("答えを入力してください。", "error");
    return;
  }

  await submitCurrentAnswer();
}

async function handleIncorrectAttempt() {
  if (!currentQuestion) {
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: "REGISTER_INCORRECT_ANSWER",
      listId: currentQuestion.listId,
      cardId: currentQuestion.cardId
    });

    if (!response?.ok) {
      throw new Error("Incorrect answer handling failed.");
    }

    setFeedback(response.feedback || "不正解です。", "error");
    setAnswerReveal(buildAnswerRevealMessage(response.correctAnswer, response.correctReading));

    if (response.shouldStartPenalty) {
      startPenaltyCountdown((response.penaltyDurationMs || 0) / 1000);
      return;
    }

    resultState = "retry-ready";
    currentInput = "";
    currentChoices = [];
    renderQuestion();
    if (resetButtonElement) {
      resetButtonElement.hidden = false;
      resetButtonElement.disabled = false;
      resetButtonElement.textContent = "再挑戦";
    }
  } catch (error) {
    console.error("Failed to register incorrect answer:", error);
    setFeedback("不正解の処理に失敗しました。", "error");
  }
}

async function submitCurrentAnswer() {
  if (!currentQuestion) {
    return;
  }

  isSubmittingAnswer = true;
  renderQuestion();
  setFeedback("正解を確認しています…");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "SUBMIT_ANSWER",
      listId: currentQuestion.listId,
      cardId: currentQuestion.cardId,
      answerText: currentInput
    });

    if (response?.ok && response.isCorrect) {
      if (response.shouldUnlock) {
        resultState = "success";
        currentChoices = [];
        renderQuestion();
        setFeedback(response.feedback || "正解です。", "success");
        setAnswerReveal(buildAnswerRevealMessage(response.correctAnswer, response.correctReading));
        if (actionButtonElement) {
          actionButtonElement.hidden = false;
          actionButtonElement.disabled = false;
          actionButtonElement.textContent = "ロックを解除";
        }
        return;
      }

      setFeedback(response.feedback || "正解です。次の問題へ進みます。", "success");
      setAnswerReveal("");
      const previousQuestionKey = currentQuestionKey;
      const nextQuestion = await loadCurrentQuestion();

      if (!nextQuestion) {
        showEmptyState();
        return;
      }

      if (previousQuestionKey !== getQuestionKey(nextQuestion)) {
        resetQuizProgress();
      } else {
        renderQuestion();
      }
      return;
    }

    await handleIncorrectAttempt();
  } catch (error) {
    console.error("Failed to submit answer:", error);
    setFeedback("回答の送信に失敗しました。", "error");
  } finally {
    isSubmittingAnswer = false;
    if (overlayElement && !overlayElement.hidden) {
      renderQuestion();
    }
  }
}

async function handleUnlockButtonClick() {
  if ((resultState !== "success" && resultState !== "empty") || isSubmittingAnswer) {
    return;
  }

  isSubmittingAnswer = true;
  if (actionButtonElement) {
    actionButtonElement.disabled = true;
  }
  setFeedback("ロックを解除しています…", "success");

  try {
    const response = await chrome.runtime.sendMessage({ type: "UNLOCK_REQUEST" });
    if (response?.ok) {
      await applyLockStateAsync(response.state);
      return;
    }

    setFeedback("ロック解除に失敗しました。", "error");
    if (actionButtonElement) {
      actionButtonElement.disabled = false;
    }
  } catch (error) {
    console.error("Failed to unlock page:", error);
    setFeedback("ロック解除に失敗しました。", "error");
    if (actionButtonElement) {
      actionButtonElement.disabled = false;
    }
  } finally {
    isSubmittingAnswer = false;
    if (overlayElement && !overlayElement.hidden) {
      renderQuestion();
    }
  }
}

function updateAnswerDisplay() {
  if (!answerDisplayElement) {
    return;
  }

  answerDisplayElement.textContent = currentInput;
}
