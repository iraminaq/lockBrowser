(function () {
  async function importQuestionListFromJsonText(text) {
    const payload = JSON.parse(text);
    const normalized = globalThis.LockBrowserSchema.normalizeQuestionData(payload);
    const validation = globalThis.LockBrowserSchema.validateQuestionData(normalized);

    if (!validation.ok) {
      throw new Error(`Import data is invalid: ${validation.errors.join(" / ")}`);
    }

    return LockBrowserStorage.importQuestionListData(normalized);
  }

  async function importQuestionListFromFile(file) {
    const text = await file.text();
    return importQuestionListFromJsonText(text);
  }

  async function importQuestionsIntoListFromJsonText(text, listId) {
    const payload = JSON.parse(text);
    const normalized = globalThis.LockBrowserSchema.normalizeQuestionData(payload);
    const validation = globalThis.LockBrowserSchema.validateQuestionData(normalized);

    if (!validation.ok) {
      throw new Error(`Import data is invalid: ${validation.errors.join(" / ")}`);
    }

    return LockBrowserStorage.importQuestionListData(normalized, { targetListId: listId });
  }

  async function exportQuestionListAsJson(listId) {
    const list = await LockBrowserStorage.getListById(listId);
    if (!list) {
      throw new Error("Question list not found.");
    }

    const payload = {
      version: globalThis.LockBrowserSchema.QUESTION_DATA_VERSION,
      lists: [list]
    };

    const normalized = globalThis.LockBrowserSchema.normalizeQuestionData(payload);
    return JSON.stringify(normalized, null, 2);
  }

  globalThis.LockBrowserDashboardImport = {
    importQuestionListFromFile,
    importQuestionListFromJsonText,
    importQuestionsIntoListFromJsonText,
    exportQuestionListAsJson
  };
})();
