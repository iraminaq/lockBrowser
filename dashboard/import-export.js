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
    const [list, mediaEntries] = await Promise.all([
      LockBrowserStorage.getListById(listId),
      LockBrowserStorage.getMediaEntries()
    ]);
    if (!list) {
      throw new Error("Question list not found.");
    }

    const referencedMediaIds = collectReferencedMediaIds(list);
    const referencedMedia = mediaEntries.filter((media) => referencedMediaIds.has(media.id));

    const payload = {
      version: globalThis.LockBrowserSchema.QUESTION_DATA_VERSION,
      lists: [list],
      media: referencedMedia
    };

    const normalized = globalThis.LockBrowserSchema.normalizeQuestionData(payload);
    return JSON.stringify(normalized, null, 2);
  }

  function collectReferencedMediaIds(list) {
    const mediaIds = new Set();

    (list.items || []).forEach((item) => {
      Object.values(item.fields || {}).forEach((parts) => {
        collectPartMediaIds(parts, mediaIds);
      });

      (item.cards || []).forEach((card) => {
        (card.choices || []).forEach((choice) => {
          collectPartMediaIds(choice.parts, mediaIds);
        });
      });
    });

    return mediaIds;
  }

  function collectPartMediaIds(parts, mediaIds) {
    (Array.isArray(parts) ? parts : []).forEach((part) => {
      if (part && typeof part.mediaId === "string" && part.mediaId) {
        mediaIds.add(part.mediaId);
      }
    });
  }

  globalThis.LockBrowserDashboardImport = {
    importQuestionListFromFile,
    importQuestionListFromJsonText,
    importQuestionsIntoListFromJsonText,
    exportQuestionListAsJson
  };
})();
