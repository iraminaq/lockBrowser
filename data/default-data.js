(function () {
  const DEFAULT_QUESTION_DATA_V2 = {
    version: 2,
    media: [],
    lists: [
      {
        id: "list-en-basic",
        title: "English Basics",
        description: "Step 1 sample data in the v2 question schema.",
        enabled: true,
        pausedAt: null,
        items: [
          createTextItem(
            "item-001",
            "apple",
            "ringo",
            "ringo",
            "Basic fruit vocabulary.",
            ["keyboard", "candidate"]
          ),
          createTextItem("item-002", "dog", "inu", "inu", "Basic animal vocabulary."),
          createTextItem("item-003", "book", "hon", "hon", "Basic object vocabulary."),
          createTextItem(
            "item-004",
            "AWS",
            "Amazon Web Services",
            "Amazon Web Services",
            "Common cloud platform acronym."
          ),
          createTextItem("item-005", "tokyo", "Tokyo", "Tokyo", "Capital city example."),
          createMcqItem(
            "item-006",
            "apple の意味は？",
            "りんご",
            "りんご",
            "4択カードのサンプルです。",
            ["ばなな", "りんご", "ぶどう", "みかん"],
            "choice-2"
          )
        ]
      }
    ]
  };

  function createTextItem(id, frontText, backText, readingText, explanationText, modes = ["keyboard"]) {
    return {
      id,
      fields: {
        front: [{ type: "text", value: frontText }],
        back: [{ type: "text", value: backText }],
        reading: [{ type: "text", value: readingText }],
        explanation: explanationText ? [{ type: "text", value: explanationText }] : []
      },
      cards: modes.map((mode, index) => ({
        id: `${id}-card-${String(index + 1).padStart(3, "0")}`,
        template: "front-to-back",
        input: { mode },
        answer: {
          type: "text",
          accepted: [readingText]
        },
        choices: []
      })),
      tags: []
    };
  }

  function createMcqItem(
    id,
    frontText,
    backText,
    readingText,
    explanationText,
    choices,
    correctChoiceId
  ) {
    return {
      id,
      fields: {
        front: [{ type: "text", value: frontText }],
        back: [{ type: "text", value: backText }],
        reading: [{ type: "text", value: readingText }],
        explanation: explanationText ? [{ type: "text", value: explanationText }] : []
      },
      cards: [
        {
          id: `${id}-card-001`,
          template: "front-mcq-back",
          input: { mode: "multiple-choice" },
          answer: {
            type: "choice",
            accepted: [],
            correctChoiceIds: [correctChoiceId]
          },
          choices: choices.map((choiceText, index) => ({
            id: `choice-${index + 1}`,
            parts: [{ type: "text", value: choiceText }]
          }))
        }
      ],
      tags: []
    };
  }

  globalThis.LockBrowserDefaults = {
    DEFAULT_QUESTION_DATA_V2
  };
})();
