(function () {
  const DEFAULT_QUESTION_LISTS = [
    {
      id: "list-en-basic",
      name: "Basic English",
      description: "Small starter deck for the lock overlay MVP.",
      enabled: true,
      pausedAt: null
    }
  ];

  const DEFAULT_QUESTIONS = [
    {
      listId: "list-en-basic",
      id: "word-001",
      prompt: "apple \u306e\u610f\u5473\u306f\uff1f",
      displayAnswer: "\u308a\u3093\u3054",
      answerReading: "\u308a\u3093\u3054",
      explanation: "apple = \u308a\u3093\u3054"
    },
    {
      listId: "list-en-basic",
      id: "word-002",
      prompt: "dog \u306e\u610f\u5473\u306f\uff1f",
      displayAnswer: "\u3044\u306c",
      answerReading: "\u3044\u306c",
      explanation: "dog = \u3044\u306c"
    },
    {
      listId: "list-en-basic",
      id: "word-003",
      prompt: "book \u306e\u610f\u5473\u306f\uff1f",
      displayAnswer: "\u307b\u3093",
      answerReading: "\u307b\u3093",
      explanation: "book = \u307b\u3093"
    }
  ];

  globalThis.LockBrowserDefaults = {
    DEFAULT_QUESTION_LISTS,
    DEFAULT_QUESTIONS
  };
})();
