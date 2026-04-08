const OVERLAY_ID = "study-gate-lock-overlay";
const LOCK_STATE_KEY = "lockState";
const PENALTY_DURATION_SECONDS = 10;
const DUMMY_CHAR_POOL = [
  "\u3042", "\u3044", "\u3046", "\u3048", "\u304a",
  "\u304b", "\u304d", "\u304f", "\u3051", "\u3053",
  "\u3055", "\u3057", "\u3059", "\u305b", "\u305d",
  "\u305f", "\u3061", "\u3064", "\u3066", "\u3068",
  "\u306a", "\u306b", "\u306c", "\u306d", "\u306e",
  "\u306f", "\u3072", "\u3075", "\u3078", "\u307b",
  "\u307e", "\u307f", "\u3080", "\u3081", "\u3082",
  "\u3084", "\u3086", "\u3088", "\u3089", "\u308b",
  "\u308c", "\u308d", "\u308f", "\u3092", "\u3093"
];

let overlayElement = null;
let questionPromptElement = null;
let answerDisplayElement = null;
let choicesContainerElement = null;
let feedbackElement = null;
let answerRevealElement = null;
let resetButtonElement = null;
let actionButtonElement = null;
let currentQuestion = null;
let currentInput = "";
let isSubmittingAnswer = false;
let currentChoices = [];
let penaltyCountdownSeconds = 0;
let penaltyTimerId = null;
let resultState = "playing";

initialize();

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "LOCK_STATE_CHANGED") {
    return;
  }

  applyLockState(message.state);
});

async function initialize() {
  try {
    const state = await getInitialLockState();
    applyLockState(state);
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

  overlayElement = document.getElementById(OVERLAY_ID);
  if (overlayElement) {
    return overlayElement;
  }

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.setAttribute("data-locked", "true");

  const panel = document.createElement("div");
  panel.className = "study-gate-panel";

  const title = document.createElement("h1");
  title.className = "study-gate-title";
  title.textContent = "\u30ed\u30c3\u30af\u4e2d";

  const description = document.createElement("p");
  description.className = "study-gate-description";
  description.textContent =
    "\u6587\u5b57\u30921\u3064\u305a\u3064\u9078\u3093\u3067\u3001\u7b54\u3048\u3092\u5b8c\u6210\u3055\u305b\u3066\u304f\u3060\u3055\u3044\u3002";

  const questionPrompt = document.createElement("p");
  questionPrompt.className = "study-gate-question";

  const answerDisplay = document.createElement("div");
  answerDisplay.className = "study-gate-answer-display";

  const choices = document.createElement("div");
  choices.className = "study-gate-choices";

  const feedback = document.createElement("p");
  feedback.className = "study-gate-feedback";
  feedback.hidden = true;

  const answerReveal = document.createElement("p");
  answerReveal.className = "study-gate-answer-reveal";
  answerReveal.hidden = true;

  const resetButton = document.createElement("button");
  resetButton.className = "study-gate-reset-button";
  resetButton.type = "button";
  resetButton.textContent = "\u3082\u3046\u4e00\u5ea6";
  resetButton.hidden = true;
  resetButton.addEventListener("click", resetQuizProgress);

  const actionButton = document.createElement("button");
  actionButton.className = "study-gate-action-button";
  actionButton.type = "button";
  actionButton.textContent = "\u30ed\u30c3\u30af\u3092\u89e3\u9664";
  actionButton.hidden = true;
  actionButton.addEventListener("click", () => {
    void handleUnlockButtonClick();
  });

  questionPromptElement = questionPrompt;
  answerDisplayElement = answerDisplay;
  choicesContainerElement = choices;
  feedbackElement = feedback;
  answerRevealElement = answerReveal;
  resetButtonElement = resetButton;
  actionButtonElement = actionButton;

  panel.append(
    title,
    description,
    questionPrompt,
    answerDisplay,
    choices,
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
  return overlayElement;
}

function applyLockState(state) {
  if (state?.isLocked) {
    void showOverlay();
    return;
  }

  hideOverlay();
}

async function showOverlay() {
  const overlay = ensureOverlay();
  attachOverlayIfNeeded(overlay);
  await loadCurrentQuestion();
  resetQuizProgress();
  overlayElement.hidden = false;
  overlayElement.setAttribute("data-locked", "true");
}

function hideOverlay() {
  if (!overlayElement) {
    return;
  }

  clearPenaltyCountdown();
  overlayElement.hidden = true;
  overlayElement.setAttribute("data-locked", "false");
  setFeedback("");
  setAnswerReveal("");
  currentQuestion = null;
  isSubmittingAnswer = false;
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
  if (!response?.ok || !response.question) {
    throw new Error("Quiz question is unavailable.");
  }

  currentQuestion = response.question;
  return currentQuestion;
}

function resetQuizProgress() {
  clearPenaltyCountdown();
  currentInput = "";
  currentChoices = createChoicesForCurrentStep();
  isSubmittingAnswer = false;
  resultState = "playing";
  setFeedback("");
  setAnswerReveal("");

  if (resetButtonElement) {
    resetButtonElement.hidden = true;
    resetButtonElement.disabled = false;
  }

  if (actionButtonElement) {
    actionButtonElement.hidden = true;
    actionButtonElement.disabled = false;
  }

  renderQuestion();
}

function renderQuestion() {
  if (
    !currentQuestion ||
    !questionPromptElement ||
    !answerDisplayElement ||
    !choicesContainerElement
  ) {
    return;
  }

  questionPromptElement.textContent = currentQuestion.prompt;
  answerDisplayElement.textContent = currentInput || "\u30fb";
  answerDisplayElement.dataset.completed = String(resultState === "success");
  answerDisplayElement.dataset.locked = String(isInputLocked());

  choicesContainerElement.replaceChildren();

  if (resultState === "playing") {
    currentChoices.forEach((choice) => {
      const button = document.createElement("button");
      button.className = "study-gate-choice-button";
      button.type = "button";
      button.textContent = choice;
      button.disabled = isInputLocked();
      button.addEventListener("click", () => {
        void handleCharacterClick(choice);
      });

      choicesContainerElement.append(button);
    });
  }

  choicesContainerElement.hidden = resultState !== "playing";

  if (resetButtonElement) {
    resetButtonElement.disabled = isInputLocked();
  }
}

function createChoicesForCurrentStep() {
  if (!currentQuestion) {
    return [];
  }

  const nextChar = currentQuestion.answerReading[currentInput.length];
  if (!nextChar) {
    return [];
  }

  const uniqueChoices = new Set([nextChar]);

  while (uniqueChoices.size < 4) {
    const dummyChar = DUMMY_CHAR_POOL[Math.floor(Math.random() * DUMMY_CHAR_POOL.length)];
    if (!currentQuestion.answerReading.includes(dummyChar) && !uniqueChoices.has(dummyChar)) {
      uniqueChoices.add(dummyChar);
    }
  }

  return shuffle(Array.from(uniqueChoices));
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

function isInputLocked() {
  return isSubmittingAnswer || penaltyCountdownSeconds > 0;
}

function startPenaltyCountdown() {
  clearPenaltyCountdown();
  penaltyCountdownSeconds = PENALTY_DURATION_SECONDS;
  currentChoices = [];
  resultState = "penalty";

  if (resetButtonElement) {
    resetButtonElement.hidden = true;
  }

  if (actionButtonElement) {
    actionButtonElement.hidden = true;
  }

  updatePenaltyFeedback();
  renderQuestion();

  penaltyTimerId = window.setInterval(() => {
    penaltyCountdownSeconds -= 1;

    if (penaltyCountdownSeconds <= 0) {
      clearPenaltyCountdown();
      resetQuizProgress();
      return;
    }

    updatePenaltyFeedback();
    renderQuestion();
  }, 1000);
}

function clearPenaltyCountdown() {
  if (penaltyTimerId !== null) {
    window.clearInterval(penaltyTimerId);
    penaltyTimerId = null;
  }

  penaltyCountdownSeconds = 0;
}

function updatePenaltyFeedback() {
  if (!currentQuestion) {
    return;
  }

  const readingDetail =
    currentQuestion.answerReading !== currentQuestion.displayAnswer
      ? ` (${currentQuestion.answerReading})`
      : "";

  setFeedback(
    `\u4e0d\u6b63\u89e3\u3067\u3059\u3002${penaltyCountdownSeconds}\u79d2\u5f8c\u306b\u518d\u6311\u6226\u3067\u304d\u307e\u3059`,
    "error"
  );
  setAnswerReveal(`\u6b63\u89e3: ${currentQuestion.displayAnswer}${readingDetail}`);
}

async function handleCharacterClick(character) {
  if (!currentQuestion || isInputLocked()) {
    return;
  }

  currentInput += character;
  renderQuestion();

  const answerReading = currentQuestion.answerReading;
  if (!answerReading.startsWith(currentInput)) {
    startPenaltyCountdown();
    return;
  }

  if (currentInput === answerReading) {
    await submitCompletedAnswer();
    return;
  }

  currentChoices = createChoicesForCurrentStep();
  setFeedback("");
  renderQuestion();
}

async function submitCompletedAnswer() {
  if (!currentQuestion) {
    return;
  }

  isSubmittingAnswer = true;
  renderQuestion();
  setFeedback("\u6b63\u89e3\u3092\u78ba\u8a8d\u3057\u3066\u3044\u307e\u3059\u2026");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "SUBMIT_ANSWER",
      listId: currentQuestion.listId,
      questionId: currentQuestion.id,
      answerReading: currentInput
    });

    if (response?.ok && response.isCorrect) {
      resultState = "success";
      currentChoices = [];
      setFeedback(response.feedback || "\u6b63\u89e3\u3067\u3059\u3002", "success");
      setAnswerReveal(
        response.correctReading && response.correctReading !== response.correctAnswer
          ? `\u6b63\u89e3: ${response.correctAnswer} (${response.correctReading})`
          : `\u6b63\u89e3: ${response.correctAnswer || currentQuestion.displayAnswer}`
      );
      if (actionButtonElement) {
        actionButtonElement.hidden = false;
      }
      renderQuestion();
      return;
    }

    startPenaltyCountdown();
  } catch (error) {
    console.error("Failed to submit quiz answer:", error);
    setFeedback(
      "\u30a8\u30e9\u30fc\u304c\u767a\u751f\u3057\u307e\u3057\u305f\u3002\u3082\u3046\u4e00\u5ea6\u8a66\u3057\u3066\u304f\u3060\u3055\u3044\u3002",
      "error"
    );
  } finally {
    isSubmittingAnswer = false;
    if (overlayElement && !overlayElement.hidden) {
      renderQuestion();
    }
  }
}

async function handleUnlockButtonClick() {
  if (resultState !== "success" || isSubmittingAnswer) {
    return;
  }

  isSubmittingAnswer = true;
  if (actionButtonElement) {
    actionButtonElement.disabled = true;
  }
  setFeedback("\u30ed\u30c3\u30af\u3092\u89e3\u9664\u3057\u3066\u3044\u307e\u3059\u2026", "success");

  try {
    const response = await chrome.runtime.sendMessage({ type: "UNLOCK_REQUEST" });
    if (response?.ok) {
      applyLockState(response.state);
      return;
    }

    setFeedback(
      "\u30ed\u30c3\u30af\u89e3\u9664\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002\u3082\u3046\u4e00\u5ea6\u8a66\u3057\u3066\u304f\u3060\u3055\u3044\u3002",
      "error"
    );
    if (actionButtonElement) {
      actionButtonElement.disabled = false;
    }
  } catch (error) {
    console.error("Failed to unlock page:", error);
    setFeedback(
      "\u30ed\u30c3\u30af\u89e3\u9664\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002\u3082\u3046\u4e00\u5ea6\u8a66\u3057\u3066\u304f\u3060\u3055\u3044\u3002",
      "error"
    );
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
