(function () {
  function inferAnswerReading(displayAnswer) {
    const source = String(displayAnswer || "").trim();
    if (!source) {
      return "";
    }

    if (/^[ぁ-んー]+$/.test(source)) {
      return source;
    }

    if (/^[ァ-ヶー]+$/.test(source)) {
      return toHiragana(source);
    }

    if (/^[a-zA-Z0-9\\s-]+$/.test(source)) {
      return source.toLowerCase().trim();
    }

    return "";
  }

  function toHiragana(text) {
    return Array.from(text)
      .map((character) => {
        const code = character.charCodeAt(0);
        if (code >= 0x30a1 && code <= 0x30f6) {
          return String.fromCharCode(code - 0x60);
        }

        return character;
      })
      .join("");
  }

  globalThis.LockBrowserReadingHelper = {
    inferAnswerReading
  };
})();
