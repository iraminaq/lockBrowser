async function importQuestionListFromJsonText(text) {
  const payload = JSON.parse(text);
  return LockBrowserStorage.importQuestionListData(payload);
}

globalThis.LockBrowserDashboardImport = {
  importQuestionListFromJsonText
};
