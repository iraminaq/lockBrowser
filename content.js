const OVERLAY_ID = "study-gate-lock-overlay";

let overlayElement = null;

initialize();

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "LOCK_STATE_CHANGED") {
    return;
  }

  applyLockState(message.state);
});

async function initialize() {
  ensureOverlay();

  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_LOCK_STATE" });
    if (response?.ok) {
      applyLockState(response.state);
    } else {
      showOverlay();
    }
  } catch (error) {
    console.error("Failed to initialize lock overlay:", error);
    showOverlay();
  }
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
    "\u3053\u306e\u30da\u30fc\u30b8\u306f\u4e00\u6642\u7684\u306b\u30ed\u30c3\u30af\u3055\u308c\u3066\u3044\u307e\u3059\u3002";

  const button = document.createElement("button");
  button.className = "study-gate-button";
  button.type = "button";
  button.textContent = "\u89e3\u9664";
  button.addEventListener("click", handleUnlockClick);

  panel.append(title, description, button);
  overlay.append(panel);

  const root = document.documentElement || document.body;
  root.append(overlay);

  overlayElement = overlay;
  return overlayElement;
}

function applyLockState(state) {
  ensureOverlay();

  if (state?.isLocked) {
    showOverlay();
    return;
  }

  hideOverlay();
}

function showOverlay() {
  ensureOverlay();
  overlayElement.hidden = false;
  overlayElement.setAttribute("data-locked", "true");
}

function hideOverlay() {
  ensureOverlay();
  overlayElement.hidden = true;
  overlayElement.setAttribute("data-locked", "false");
}

async function handleUnlockClick() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "UNLOCK_REQUEST" });
    if (response?.ok) {
      applyLockState(response.state);
    }
  } catch (error) {
    console.error("Failed to unlock page:", error);
  }
}
