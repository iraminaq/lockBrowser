(function () {
  const QUESTION_DATA_VERSION = 2;
  const DEFAULT_FIELD_KEYS = ["front", "back", "reading", "explanation"];

  function createEmptyQuestionDataV2() {
    return {
      version: QUESTION_DATA_VERSION,
      lists: []
    };
  }

  function normalizeQuestionData(raw) {
    const safeRaw = raw && typeof raw === "object" ? raw : createEmptyQuestionDataV2();

    if (safeRaw.version !== QUESTION_DATA_VERSION) {
      throw new Error("Question data version must be 2.");
    }

    return {
      version: QUESTION_DATA_VERSION,
      lists: Array.isArray(safeRaw.lists)
        ? safeRaw.lists.map(normalizeList).filter(Boolean)
        : []
    };
  }

  function normalizeList(list) {
    const safeList = list && typeof list === "object" ? list : {};
    const id = normalizeId(safeList.id);

    if (!id) {
      return null;
    }

    return {
      id,
      title: normalizeString(safeList.title, "New List"),
      description: normalizeString(safeList.description, ""),
      enabled: typeof safeList.enabled === "boolean" ? safeList.enabled : true,
      pausedAt:
        typeof safeList.pausedAt === "number" && Number.isFinite(safeList.pausedAt)
          ? safeList.pausedAt
          : null,
      items: Array.isArray(safeList.items)
        ? safeList.items.map(normalizeItem).filter(Boolean)
        : []
    };
  }

  function normalizeItem(item) {
    const safeItem = item && typeof item === "object" ? item : {};
    const id = normalizeId(safeItem.id);

    if (!id) {
      return null;
    }

    return {
      id,
      fields: normalizeFields(safeItem.fields),
      cards: Array.isArray(safeItem.cards)
        ? safeItem.cards.map(normalizeCard).filter(Boolean)
        : [],
      tags: Array.isArray(safeItem.tags)
        ? safeItem.tags.filter((tag) => typeof tag === "string" && tag.trim() !== "")
        : []
    };
  }

  function normalizeFields(fields) {
    const safeFields = fields && typeof fields === "object" ? fields : {};
    const nextFields = {};

    DEFAULT_FIELD_KEYS.forEach((fieldKey) => {
      nextFields[fieldKey] = normalizeParts(safeFields[fieldKey]);
    });

    for (const [fieldKey, value] of Object.entries(safeFields)) {
      if (!(fieldKey in nextFields)) {
        nextFields[fieldKey] = normalizeParts(value);
      }
    }

    return nextFields;
  }

  function normalizeCard(card) {
    const safeCard = card && typeof card === "object" ? card : {};
    const id = normalizeId(safeCard.id);

    if (!id) {
      return null;
    }

    return {
      id,
      template: normalizeString(safeCard.template, "front-to-back"),
      input: {
        mode: normalizeInputMode(safeCard.input?.mode)
      },
      answer: normalizeAnswer(safeCard.answer),
      choices: Array.isArray(safeCard.choices)
        ? safeCard.choices.map(normalizeChoice).filter(Boolean)
        : []
    };
  }

  function normalizeAnswer(answer) {
    const safeAnswer = answer && typeof answer === "object" ? answer : {};
    return {
      type: normalizeAnswerType(safeAnswer.type),
      accepted: Array.isArray(safeAnswer.accepted)
        ? safeAnswer.accepted
            .map((value) => normalizeString(value, ""))
            .filter((value) => value !== "")
        : [],
      correctChoiceIds: Array.isArray(safeAnswer.correctChoiceIds)
        ? safeAnswer.correctChoiceIds
            .map((value) => normalizeString(value, ""))
            .filter((value) => value !== "")
        : []
    };
  }

  function normalizeChoice(choice) {
    const safeChoice = choice && typeof choice === "object" ? choice : {};
    const id = normalizeId(safeChoice.id);

    if (!id) {
      return null;
    }

    return {
      id,
      parts: normalizeParts(safeChoice.parts)
    };
  }

  function normalizeParts(parts) {
    const safeParts = Array.isArray(parts) ? parts : [];

    return safeParts
      .map((part) => {
        if (!part || typeof part !== "object") {
          return null;
        }

        if (part.type === "text") {
          return {
            type: "text",
            value: normalizeString(part.value, "")
          };
        }

        if (part.type === "image") {
          return {
            type: "image",
            src: normalizeString(part.src, ""),
            mediaId: normalizeString(part.mediaId, "")
          };
        }

        if (part.type === "audio") {
          return {
            type: "audio",
            src: normalizeString(part.src, ""),
            mediaId: normalizeString(part.mediaId, "")
          };
        }

        if (typeof part.type === "string") {
          return {
            ...part,
            type: part.type
          };
        }

        return null;
      })
      .filter(Boolean);
  }

  function validateQuestionData(data) {
    const errors = [];

    if (!data || typeof data !== "object") {
      errors.push("Question data must be an object.");
      return { ok: false, errors };
    }

    if (data.version !== QUESTION_DATA_VERSION) {
      errors.push("Question data version must be 2.");
    }

    if (!Array.isArray(data.lists)) {
      errors.push("Question data must contain a lists array.");
      return { ok: errors.length === 0, errors };
    }

    data.lists.forEach((list, listIndex) => {
      if (!list || typeof list !== "object") {
        errors.push(`List at index ${listIndex} is invalid.`);
        return;
      }

      if (!normalizeId(list.id)) {
        errors.push(`List at index ${listIndex} is missing id.`);
      }

      if (!Array.isArray(list.items)) {
        errors.push(`List ${list.id || listIndex} must contain an items array.`);
        return;
      }

      list.items.forEach((item, itemIndex) => {
        if (!item || typeof item !== "object") {
          errors.push(`Item at ${list.id || listIndex}:${itemIndex} is invalid.`);
          return;
        }

        if (!normalizeId(item.id)) {
          errors.push(`Item at ${list.id || listIndex}:${itemIndex} is missing id.`);
        }

        if (!item.fields || typeof item.fields !== "object") {
          errors.push(`Item ${item.id || itemIndex} must contain fields.`);
        }

        if (!Array.isArray(item.cards)) {
          errors.push(`Item ${item.id || itemIndex} must contain cards array.`);
          return;
        }

        item.cards.forEach((card, cardIndex) => {
          if (!card || typeof card !== "object") {
            errors.push(`Card at ${item.id || itemIndex}:${cardIndex} is invalid.`);
            return;
          }

          if (!normalizeId(card.id)) {
            errors.push(`Card at ${item.id || itemIndex}:${cardIndex} is missing id.`);
          }
        });
      });
    });

    return {
      ok: errors.length === 0,
      errors
    };
  }

  function normalizeString(value, fallback) {
    return typeof value === "string" ? value : fallback;
  }

  function normalizeId(value) {
    return typeof value === "string" && value.trim() !== "" ? value.trim() : "";
  }

  function normalizeInputMode(value) {
    return value === "candidate" || value === "keyboard" || value === "multiple-choice"
      ? value
      : "keyboard";
  }

  function normalizeAnswerType(value) {
    return value === "choice" || value === "text" ? value : "text";
  }

  globalThis.LockBrowserSchema = {
    QUESTION_DATA_VERSION,
    DEFAULT_FIELD_KEYS,
    createEmptyQuestionDataV2,
    normalizeQuestionData,
    normalizeList,
    normalizeItem,
    normalizeCard,
    normalizeParts,
    validateQuestionData
  };
})();
