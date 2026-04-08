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
    },
    {
      listId: "list-en-basic",
      id: "word-004",
      prompt: "cat \u306e\u610f\u5473\u306f\uff1f",
      displayAnswer: "\u306d\u3053",
      answerReading: "\u306d\u3053",
      explanation: "cat = \u306d\u3053"
    },
    {
      listId: "list-en-basic",
      id: "word-005",
      prompt: "bird \u306e\u610f\u5473\u306f\uff1f",
      displayAnswer: "\u3068\u308a",
      answerReading: "\u3068\u308a",
      explanation: "bird = \u3068\u308a"
    },
    {
      listId: "list-en-basic",
      id: "word-006",
      prompt: "fish \u306e\u610f\u5473\u306f\uff1f",
      displayAnswer: "\u3055\u304b\u306a",
      answerReading: "\u3055\u304b\u306a",
      explanation: "fish = \u3055\u304b\u306a"
    },
    {
      listId: "list-en-basic",
      id: "word-007",
      prompt: "milk \u306e\u610f\u5473\u306f\uff1f",
      displayAnswer: "\u307f\u308b\u304f",
      answerReading: "\u307f\u308b\u304f",
      explanation: "milk = \u307f\u308b\u304f"
    },
    {
      listId: "list-en-basic",
      id: "word-008",
      prompt: "water \u306e\u610f\u5473\u306f\uff1f",
      displayAnswer: "\u307f\u305a",
      answerReading: "\u307f\u305a",
      explanation: "water = \u307f\u305a"
    },
    {
      listId: "list-en-basic",
      id: "word-009",
      prompt: "bread \u306e\u610f\u5473\u306f\uff1f",
      displayAnswer: "\u3071\u3093",
      answerReading: "\u3071\u3093",
      explanation: "bread = \u3071\u3093"
    },
    {
      listId: "list-en-basic",
      id: "word-010",
      prompt: "egg \u306e\u610f\u5473\u306f\uff1f",
      displayAnswer: "\u305f\u307e\u3054",
      answerReading: "\u305f\u307e\u3054",
      explanation: "egg = \u305f\u307e\u3054"
    },
    {
      listId: "list-en-basic",
      id: "word-011",
      prompt: "sun \u306e\u610f\u5473\u306f\uff1f",
      displayAnswer: "\u305f\u3044\u3088\u3046",
      answerReading: "\u305f\u3044\u3088\u3046",
      explanation: "sun = \u305f\u3044\u3088\u3046"
    },
    {
      listId: "list-en-basic",
      id: "word-012",
      prompt: "moon \u306e\u610f\u5473\u306f\uff1f",
      displayAnswer: "\u3064\u304d",
      answerReading: "\u3064\u304d",
      explanation: "moon = \u3064\u304d"
    },
    {
      listId: "list-en-basic",
      id: "word-013",
      prompt: "star \u306e\u610f\u5473\u306f\uff1f",
      displayAnswer: "\u307b\u3057",
      answerReading: "\u307b\u3057",
      explanation: "star = \u307b\u3057"
    },
    {
      listId: "list-en-basic",
      id: "word-014",
      prompt: "sky \u306e\u610f\u5473\u306f\uff1f",
      displayAnswer: "\u305d\u3089",
      answerReading: "\u305d\u3089",
      explanation: "sky = \u305d\u3089"
    },
    {
      listId: "list-en-basic",
      id: "word-015",
      prompt: "sea \u306e\u610f\u5473\u306f\uff1f",
      displayAnswer: "\u3046\u307f",
      answerReading: "\u3046\u307f",
      explanation: "sea = \u3046\u307f"
    },
    {
      listId: "list-en-basic",
      id: "word-016",
      prompt: "mountain \u306e\u610f\u5473\u306f\uff1f",
      displayAnswer: "\u3084\u307e",
      answerReading: "\u3084\u307e",
      explanation: "mountain = \u3084\u307e"
    },
    {
      listId: "list-en-basic",
      id: "word-017",
      prompt: "river \u306e\u610f\u5473\u306f\uff1f",
      displayAnswer: "\u304b\u308f",
      answerReading: "\u304b\u308f",
      explanation: "river = \u304b\u308f"
    },
    {
      listId: "list-en-basic",
      id: "word-018",
      prompt: "tree \u306e\u610f\u5473\u306f\uff1f",
      displayAnswer: "\u304d",
      answerReading: "\u304d",
      explanation: "tree = \u304d"
    },
    {
      listId: "list-en-basic",
      id: "word-019",
      prompt: "flower \u306e\u610f\u5473\u306f\uff1f",
      displayAnswer: "\u306f\u306a",
      answerReading: "\u306f\u306a",
      explanation: "flower = \u306f\u306a"
    },
    {
      listId: "list-en-basic",
      id: "word-020",
      prompt: "rain \u306e\u610f\u5473\u306f\uff1f",
      displayAnswer: "\u3042\u3081",
      answerReading: "\u3042\u3081",
      explanation: "rain = \u3042\u3081"
    },
    {
      listId: "list-en-basic",
      id: "word-021",
      prompt: "snow \u306e\u610f\u5473\u306f\uff1f",
      displayAnswer: "\u3086\u304d",
      answerReading: "\u3086\u304d",
      explanation: "snow = \u3086\u304d"
    },
    {
      listId: "list-en-basic",
      id: "word-022",
      prompt: "car \u306e\u610f\u5473\u306f\uff1f",
      displayAnswer: "\u304f\u308b\u307e",
      answerReading: "\u304f\u308b\u307e",
      explanation: "car = \u304f\u308b\u307e"
    },
    {
      listId: "list-en-basic",
      id: "word-023",
      prompt: "train \u306e\u610f\u5473\u306f\uff1f",
      displayAnswer: "\u3067\u3093\u3057\u3083",
      answerReading: "\u3067\u3093\u3057\u3083",
      explanation: "train = \u3067\u3093\u3057\u3083"
    },
    {
      listId: "list-en-basic",
      id: "word-024",
      prompt: "house \u306e\u610f\u5473\u306f\uff1f",
      displayAnswer: "\u3044\u3048",
      answerReading: "\u3044\u3048",
      explanation: "house = \u3044\u3048"
    },
    {
      listId: "list-en-basic",
      id: "word-025",
      prompt: "school \u306e\u610f\u5473\u306f\uff1f",
      displayAnswer: "\u304c\u3063\u3053\u3046",
      answerReading: "\u304c\u3063\u3053\u3046",
      explanation: "school = \u304c\u3063\u3053\u3046"
    },
    {
      listId: "list-en-basic",
      id: "word-026",
      prompt: "teacher \u306e\u610f\u5473\u306f\uff1f",
      displayAnswer: "\u305b\u3093\u305b\u3044",
      answerReading: "\u305b\u3093\u305b\u3044",
      explanation: "teacher = \u305b\u3093\u305b\u3044"
    },
    {
      listId: "list-en-basic",
      id: "word-027",
      prompt: "friend \u306e\u610f\u5473\u306f\uff1f",
      displayAnswer: "\u3068\u3082\u3060\u3061",
      answerReading: "\u3068\u3082\u3060\u3061",
      explanation: "friend = \u3068\u3082\u3060\u3061"
    },
    {
      listId: "list-en-basic",
      id: "word-028",
      prompt: "time \u306e\u610f\u5473\u306f\uff1f",
      displayAnswer: "\u3058\u304b\u3093",
      answerReading: "\u3058\u304b\u3093",
      explanation: "time = \u3058\u304b\u3093"
    },
    {
      listId: "list-en-basic",
      id: "word-029",
      prompt: "day \u306e\u610f\u5473\u306f\uff1f",
      displayAnswer: "\u3072",
      answerReading: "\u3072",
      explanation: "day = \u3072"
    },
    {
      listId: "list-en-basic",
      id: "word-030",
      prompt: "night \u306e\u610f\u5473\u306f\uff1f",
      displayAnswer: "\u3088\u308b",
      answerReading: "\u3088\u308b",
      explanation: "night = \u3088\u308b"
    }
  ];

  globalThis.LockBrowserDefaults = {
    DEFAULT_QUESTION_LISTS,
    DEFAULT_QUESTIONS
  };
})();
