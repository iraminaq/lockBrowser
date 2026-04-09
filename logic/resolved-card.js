(function () {
  function partsToPlainText(parts) {
    if (!Array.isArray(parts)) {
      return "";
    }

    return parts
      .map((part) => {
        if (!part || typeof part !== "object") {
          return "";
        }

        if (part.type === "text") {
          return String(part.value || "");
        }

        return "";
      })
      .join("");
  }

  function getPromptParts(item, card, mediaById) {
    if (card?.template === "front-to-back") {
      return resolveParts(item?.fields?.front, mediaById);
    }

    return resolveParts(item?.fields?.front, mediaById);
  }

  function getExplanationParts(item, mediaById) {
    return resolveParts(item?.fields?.explanation, mediaById);
  }

  function getCanonicalTextAnswer(card, item) {
    const accepted = Array.isArray(card?.answer?.accepted) ? card.answer.accepted : [];
    if (accepted.length > 0) {
      return String(accepted[0] || "");
    }

    const readingText = partsToPlainText(item?.fields?.reading);
    if (readingText) {
      return readingText;
    }

    return partsToPlainText(item?.fields?.back);
  }

  function resolveCard(list, item, card, mediaById = createMediaMap()) {
    if (!list || !item || !card) {
      return null;
    }

    const resolvedFields = resolveFields(item.fields || {}, mediaById);

    return {
      listId: list.id,
      listTitle: list.title,
      itemId: item.id,
      cardId: card.id,
      template: card.template || "front-to-back",
      fields: resolvedFields,
      promptParts: getPromptParts({ fields: resolvedFields }, card, mediaById),
      explanationParts: getExplanationParts({ fields: resolvedFields }, mediaById),
      answer: card.answer || { type: "text", accepted: [] },
      choices: Array.isArray(card.choices)
        ? card.choices.map((choice) => resolveChoice(choice, mediaById))
        : [],
      inputMode: card.input?.mode || "keyboard",
      tags: Array.isArray(item.tags) ? [...item.tags] : [],
      canonicalAnswer: getCanonicalTextAnswer(card, { fields: resolvedFields })
    };
  }

  function resolveFields(fields, mediaById) {
    const safeFields = fields && typeof fields === "object" ? fields : {};
    const resolvedFields = {};

    Object.entries(safeFields).forEach(([fieldKey, parts]) => {
      resolvedFields[fieldKey] = resolveParts(parts, mediaById);
    });

    return resolvedFields;
  }

  function resolveChoice(choice, mediaById) {
    return {
      id: choice.id,
      parts: resolveParts(choice.parts, mediaById)
    };
  }

  function resolveParts(parts, mediaById) {
    const safeParts = Array.isArray(parts) ? parts : [];
    return safeParts
      .map((part) => resolvePart(part, mediaById))
      .filter(Boolean);
  }

  function resolvePart(part, mediaById) {
    if (!part || typeof part !== "object") {
      return null;
    }

    if (part.type === "text") {
      return {
        type: "text",
        value: String(part.value || "")
      };
    }

    if (part.type === "image" || part.type === "audio") {
      return resolveMediaPart(part, mediaById);
    }

    return { ...part };
  }

  function resolveMediaPart(part, mediaById) {
    const media = part.mediaId ? mediaById.get(part.mediaId) : null;
    const src = media
      ? media.sourceType === "dataUrl"
        ? media.data
        : media.url
      : String(part.src || "");

    return {
      type: part.type,
      mediaId: part.mediaId || "",
      src,
      mimeType: media?.mimeType || "",
      mediaName: media?.name || ""
    };
  }

  function createMediaMap(questionData) {
    const mediaEntries = Array.isArray(questionData?.media) ? questionData.media : [];
    return new Map(
      mediaEntries
        .filter((media) => media && typeof media === "object" && typeof media.id === "string")
        .map((media) => [media.id, media])
    );
  }

  function getResolvedCards(questionData) {
    const lists = Array.isArray(questionData?.lists) ? questionData.lists : [];
    const mediaById = createMediaMap(questionData);
    const resolvedCards = [];

    lists.forEach((list) => {
      (list.items || []).forEach((item) => {
        (item.cards || []).forEach((card) => {
          const resolvedCard = resolveCard(list, item, card, mediaById);
          if (resolvedCard) {
            resolvedCards.push(resolvedCard);
          }
        });
      });
    });

    return resolvedCards;
  }

  function getResolvedCardsByListId(questionData, listId) {
    return getResolvedCards(questionData).filter((card) => card.listId === listId);
  }

  function findResolvedCard(questionData, listId, cardId) {
    return (
      getResolvedCards(questionData).find(
        (card) => card.listId === listId && card.cardId === cardId
      ) || null
    );
  }

  globalThis.LockBrowserResolvedCard = {
    partsToPlainText,
    resolveCard,
    resolveParts,
    getResolvedCards,
    getResolvedCardsByListId,
    findResolvedCard,
    getCanonicalTextAnswer
  };
})();
