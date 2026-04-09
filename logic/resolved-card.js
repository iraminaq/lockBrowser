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

  function getPromptParts(item, card) {
    if (card?.template === "front-to-back") {
      return Array.isArray(item?.fields?.front) ? item.fields.front : [];
    }

    return Array.isArray(item?.fields?.front) ? item.fields.front : [];
  }

  function getExplanationParts(item) {
    return Array.isArray(item?.fields?.explanation) ? item.fields.explanation : [];
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

  function resolveCard(list, item, card) {
    if (!list || !item || !card) {
      return null;
    }

    return {
      listId: list.id,
      listTitle: list.title,
      itemId: item.id,
      cardId: card.id,
      template: card.template || "front-to-back",
      fields: item.fields || {},
      promptParts: getPromptParts(item, card),
      explanationParts: getExplanationParts(item),
      answer: card.answer || { type: "text", accepted: [] },
      choices: Array.isArray(card.choices) ? card.choices.map(cloneChoice) : [],
      inputMode: card.input?.mode || "keyboard",
      tags: Array.isArray(item.tags) ? [...item.tags] : [],
      canonicalAnswer: getCanonicalTextAnswer(card, item)
    };
  }

  function cloneChoice(choice) {
    return {
      id: choice.id,
      parts: Array.isArray(choice.parts) ? choice.parts.map((part) => ({ ...part })) : []
    };
  }

  function getResolvedCards(questionData) {
    const lists = Array.isArray(questionData?.lists) ? questionData.lists : [];
    const resolvedCards = [];

    lists.forEach((list) => {
      (list.items || []).forEach((item) => {
        (item.cards || []).forEach((card) => {
          const resolvedCard = resolveCard(list, item, card);
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
    getResolvedCards,
    getResolvedCardsByListId,
    findResolvedCard,
    getCanonicalTextAnswer
  };
})();
