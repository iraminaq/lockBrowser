(function () {
  const QUESTION_DATA_VERSION = 2;
  const DEFAULT_FIELD_KEYS = ["front", "back", "reading", "explanation"];
  const SUPPORTED_MEDIA_SOURCE_TYPES = new Set(["url", "dataUrl", "blobRef"]);

  function createEmptyQuestionDataV2() {
    return {
      version: QUESTION_DATA_VERSION,
      lists: [],
      media: []
    };
  }

  function normalizeQuestionData(raw) {
    const safeRaw = raw && typeof raw === "object" ? raw : createEmptyQuestionDataV2();

    if (safeRaw.version !== QUESTION_DATA_VERSION) {
      throw new Error("Question data version must be 2.");
    }

    const context = createNormalizationContext(safeRaw.media);

    return {
      version: QUESTION_DATA_VERSION,
      lists: Array.isArray(safeRaw.lists)
        ? safeRaw.lists.map((list) => normalizeList(list, context)).filter(Boolean)
        : [],
      media: context.getMediaList()
    };
  }

  function normalizeList(list, context) {
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
        ? safeList.items.map((item) => normalizeItem(item, context)).filter(Boolean)
        : []
    };
  }

  function normalizeItem(item, context) {
    const safeItem = item && typeof item === "object" ? item : {};
    const id = normalizeId(safeItem.id);

    if (!id) {
      return null;
    }

    return {
      id,
      fields: normalizeFields(safeItem.fields, context),
      cards: Array.isArray(safeItem.cards)
        ? safeItem.cards.map((card) => normalizeCard(card, context)).filter(Boolean)
        : [],
      tags: Array.isArray(safeItem.tags)
        ? safeItem.tags.filter((tag) => typeof tag === "string" && tag.trim() !== "")
        : []
    };
  }

  function normalizeFields(fields, context) {
    const safeFields = fields && typeof fields === "object" ? fields : {};
    const nextFields = {};

    DEFAULT_FIELD_KEYS.forEach((fieldKey) => {
      nextFields[fieldKey] = normalizeParts(safeFields[fieldKey], context);
    });

    for (const [fieldKey, value] of Object.entries(safeFields)) {
      if (!(fieldKey in nextFields)) {
        nextFields[fieldKey] = normalizeParts(value, context);
      }
    }

    return nextFields;
  }

  function normalizeCard(card, context) {
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
        ? safeCard.choices.map((choice) => normalizeChoice(choice, context)).filter(Boolean)
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

  function normalizeChoice(choice, context) {
    const safeChoice = choice && typeof choice === "object" ? choice : {};
    const id = normalizeId(safeChoice.id);

    if (!id) {
      return null;
    }

    return {
      id,
      parts: normalizeParts(safeChoice.parts, context)
    };
  }

  function normalizeParts(parts, context) {
    const safeParts = Array.isArray(parts) ? parts : [];

    return safeParts
      .map((part) => normalizePart(part, context))
      .filter(Boolean);
  }

  function normalizePart(part, context) {
    if (!part || typeof part !== "object") {
      return null;
    }

    if (part.type === "text") {
      const value = normalizeString(part.value, "");
      return value ? { type: "text", value } : null;
    }

    if (part.type === "image" || part.type === "audio") {
      return normalizeMediaPart(part, context);
    }

    if (typeof part.type === "string") {
      return {
        ...part,
        type: part.type
      };
    }

    return null;
  }

  function normalizeMediaPart(part, context) {
    const mediaId = context
      ? context.ensureMedia(part)
      : normalizeId(part.mediaId);
    const legacySrc = normalizeString(part.src, "");

    if (!mediaId && !legacySrc) {
      return null;
    }

    const normalized = {
      type: part.type
    };

    if (mediaId) {
      normalized.mediaId = mediaId;
    } else if (legacySrc) {
      normalized.src = legacySrc;
    }

    return normalized;
  }

  function normalizeMedia(media) {
    const safeMedia = media && typeof media === "object" ? media : {};
    const id = normalizeId(safeMedia.id);
    const kind = normalizeMediaKind(safeMedia.kind);

    if (!id || !kind) {
      return null;
    }

    const sourceType = normalizeMediaSourceType(safeMedia.sourceType);
    const url = normalizeString(safeMedia.url, "");
    const data = normalizeString(safeMedia.data, "");

    return {
      id,
      kind,
      sourceType,
      url: sourceType === "url" ? url : "",
      data: sourceType === "dataUrl" ? data : "",
      mimeType: normalizeString(safeMedia.mimeType, ""),
      name: normalizeString(safeMedia.name, ""),
      createdAt: normalizeTimestamp(safeMedia.createdAt),
      updatedAt: normalizeTimestamp(safeMedia.updatedAt)
    };
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

    const mediaById = new Map();
    if (!Array.isArray(data.media)) {
      errors.push("Question data must contain a media array.");
    } else {
      data.media.forEach((media, mediaIndex) => {
        const normalizedMedia = normalizeMedia(media);
        if (!normalizedMedia) {
          errors.push(`Media at index ${mediaIndex} is invalid.`);
          return;
        }

        mediaById.set(normalizedMedia.id, normalizedMedia);
      });
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
        } else {
          validatePartsObject(item.fields, mediaById, errors, `Item ${item.id || itemIndex}`);
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

          if (Array.isArray(card.choices)) {
            card.choices.forEach((choice, choiceIndex) => {
              if (!choice || typeof choice !== "object") {
                errors.push(`Choice at ${card.id || cardIndex}:${choiceIndex} is invalid.`);
                return;
              }

              validateParts(choice.parts, mediaById, errors, `Choice ${choice.id || choiceIndex}`);
            });
          }
        });
      });
    });

    return {
      ok: errors.length === 0,
      errors
    };
  }

  function validatePartsObject(fields, mediaById, errors, contextLabel) {
    Object.entries(fields).forEach(([fieldKey, parts]) => {
      validateParts(parts, mediaById, errors, `${contextLabel}.${fieldKey}`);
    });
  }

  function validateParts(parts, mediaById, errors, contextLabel) {
    if (!Array.isArray(parts)) {
      return;
    }

    parts.forEach((part, partIndex) => {
      if (!part || typeof part !== "object") {
        return;
      }

      if (part.type !== "image" && part.type !== "audio") {
        return;
      }

      const mediaId = normalizeId(part.mediaId);
      if (!mediaId) {
        errors.push(`${contextLabel}[${partIndex}] is missing mediaId.`);
        return;
      }

      const media = mediaById.get(mediaId);
      if (!media) {
        errors.push(`${contextLabel}[${partIndex}] references missing media ${mediaId}.`);
        return;
      }

      if (media.kind !== part.type) {
        errors.push(`${contextLabel}[${partIndex}] media kind mismatch for ${mediaId}.`);
      }
    });
  }

  function createNormalizationContext(rawMedia) {
    const mediaById = new Map();
    const mediaBySignature = new Map();

    (Array.isArray(rawMedia) ? rawMedia : []).forEach((media) => {
      const normalizedMedia = normalizeMedia(media);
      if (!normalizedMedia) {
        return;
      }

      mediaById.set(normalizedMedia.id, normalizedMedia);
      mediaBySignature.set(getMediaSignature(normalizedMedia), normalizedMedia.id);
    });

    return {
      ensureMedia(part) {
        const existingMediaId = normalizeId(part.mediaId);
        if (existingMediaId && mediaById.has(existingMediaId)) {
          return existingMediaId;
        }

        const kind = normalizeMediaKind(part.type);
        const src = normalizeString(part.src, "");
        if (!kind || !src) {
          return existingMediaId;
        }

        const mediaShape = normalizeMedia({
          id: createMediaId(kind),
          kind,
          sourceType: "url",
          url: src,
          mimeType: normalizeString(part.mimeType, ""),
          name: normalizeString(part.name, ""),
          createdAt: Date.now(),
          updatedAt: Date.now()
        });

        const signature = getMediaSignature(mediaShape);
        const existingId = mediaBySignature.get(signature);
        if (existingId) {
          return existingId;
        }

        mediaById.set(mediaShape.id, mediaShape);
        mediaBySignature.set(signature, mediaShape.id);
        return mediaShape.id;
      },
      getMediaList() {
        return Array.from(mediaById.values());
      }
    };
  }

  function getMediaSignature(media) {
    return [
      media.kind,
      media.sourceType,
      media.url || "",
      media.data || "",
      media.mimeType || "",
      media.name || ""
    ].join("::");
  }

  function createMediaId(kind) {
    return `media-${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

  function normalizeMediaKind(value) {
    return value === "image" || value === "audio" ? value : "";
  }

  function normalizeMediaSourceType(value) {
    return SUPPORTED_MEDIA_SOURCE_TYPES.has(value) ? value : "url";
  }

  function normalizeTimestamp(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : Date.now();
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
    validateQuestionData,
    normalizeMedia
  };
})();
