// FILE: src/afk/telegram.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Minimal Telegram Bot API transport for /afk one-way-door escalations.
//   SCOPE: sendMessage + getUpdates + reply matching + answer classification. Plain text only (no markdown parsing — user-controlled fields flow through, injection must be impossible).
//   DEPENDS: Web fetch API (injectable via `transport` param for tests)
//   LINKS: M-AFK-TELEGRAM, https://core.telegram.org/bots/api
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   TelegramTransport   - Injectable fetch-compatible function signature used by tests
//   TelegramConfig             - Shape: { botToken, chatId }
//   SendMessageResult          - Shape: { ok, messageId?, errorDescription? }
//   IncomingReply              - Normalized update with chatId, optional fromMessageId, optional callbackQueryId
//   InlineButton               - One inline-keyboard button: { text, callbackData }
//   InlineKeyboard             - Matrix of InlineButton rows
//   sendMessage                - POST to /sendMessage; accepts optional inline keyboard
//   answerCallbackQuery        - POST to /answerCallbackQuery; dismisses the user's loading spinner
//   editMessageRemoveKeyboard  - POST to /editMessageReplyMarkup with an empty keyboard
//   fetchUpdates               - GET /getUpdates; parses message + callback_query; filters by chatId
//   matchReply                 - Match a reply to a correlation id (reply_to, callback prefix, or token)
//   classifyAnswer             - Strict classification: A-E / PROCEED / STOP / EVOLVE / DEFER / DETAILS / UNKNOWN
// END_MODULE_MAP

export type TelegramTransport = (url: string, init?: RequestInit) => Promise<Response>;

export type TelegramConfig = {
  botToken: string;
  chatId: string;
};

export type SendMessageResult = {
  ok: boolean;
  messageId?: number;
  errorDescription?: string;
};

export type IncomingReply = {
  updateId: number;
  text: string;
  chatId: string;
  fromMessageId?: number;
  // When present, the reply came from an inline button press. The CLI must call
  // answerCallbackQuery with this id to dismiss the loading spinner in the user's client.
  callbackQueryId?: string;
};

export type InlineButton = {
  text: string;
  callbackData: string;
};

export type InlineKeyboard = InlineButton[][];

function apiUrl(config: TelegramConfig, method: string) {
  return `https://api.telegram.org/bot${config.botToken}/${method}`;
}

// START_CONTRACT: sendMessage
//   PURPOSE: POST to /sendMessage with plain text and optional inline keyboard.
//   INPUTS: { config, text, keyboard?, transport? }
//   OUTPUTS: SendMessageResult { ok, messageId?, errorDescription? }
//   SIDE_EFFECTS: HTTPS POST to Telegram Bot API.
// END_CONTRACT: sendMessage
export async function sendMessage(
  config: TelegramConfig,
  text: string,
  keyboard?: InlineKeyboard | null,
  transport: TelegramTransport = fetch,
): Promise<SendMessageResult> {
  // Plain text: user-controlled fields (titles, contexts from active .grace change bundles) flow
  // into this transport. Previously parse_mode: "Markdown" permitted injection (clickable links,
  // broken formatting, weaponized `]` / `[` pairs). We intentionally send plain text and rely
  // on `buildAskMessage` to structure the payload with whitespace, not markdown syntax.
  const payload: Record<string, unknown> = {
    chat_id: config.chatId,
    text,
    disable_web_page_preview: true,
  };
  if (keyboard && keyboard.length > 0) {
    payload.reply_markup = {
      inline_keyboard: keyboard.map((row) =>
        row.map((button) => ({ text: button.text, callback_data: button.callbackData })),
      ),
    };
  }
  const response = await transport(apiUrl(config, "sendMessage"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body = (await response.json()) as {
    ok: boolean;
    result?: { message_id: number };
    description?: string;
  };

  if (!body.ok) {
    return { ok: false, errorDescription: body.description };
  }

  return { ok: true, messageId: body.result?.message_id };
}

// START_CONTRACT: answerCallbackQuery
//   PURPOSE: Dismiss the loading spinner on an inline-button tap and optionally show a toast.
//   INPUTS: { config, callbackQueryId, text?, transport? }
//   OUTPUTS: { ok, errorDescription? }
//   SIDE_EFFECTS: HTTPS POST to Telegram Bot API.
// END_CONTRACT: answerCallbackQuery
export async function answerCallbackQuery(
  config: TelegramConfig,
  callbackQueryId: string,
  text: string | undefined,
  transport: TelegramTransport = fetch,
): Promise<{ ok: boolean; errorDescription?: string }> {
  const payload: Record<string, unknown> = { callback_query_id: callbackQueryId };
  if (text) {
    payload.text = text;
  }
  const response = await transport(apiUrl(config, "answerCallbackQuery"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as { ok: boolean; description?: string };
  return body.ok ? { ok: true } : { ok: false, errorDescription: body.description };
}

// START_CONTRACT: editMessageRemoveKeyboard
//   PURPOSE: Strip the inline keyboard from a message once a button was pressed, so the user cannot tap a second answer.
//   INPUTS: { config, messageId, transport? }
//   OUTPUTS: { ok, errorDescription? }
//   SIDE_EFFECTS: HTTPS POST to Telegram Bot API. Non-fatal on error.
// END_CONTRACT: editMessageRemoveKeyboard
export async function editMessageRemoveKeyboard(
  config: TelegramConfig,
  messageId: number,
  transport: TelegramTransport = fetch,
): Promise<{ ok: boolean; errorDescription?: string }> {
  const response = await transport(apiUrl(config, "editMessageReplyMarkup"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: config.chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] },
    }),
  });
  const body = (await response.json()) as { ok: boolean; description?: string };
  return body.ok ? { ok: true } : { ok: false, errorDescription: body.description };
}

export async function fetchUpdates(
  config: TelegramConfig,
  offset: number | null,
  transport: TelegramTransport = fetch,
): Promise<IncomingReply[]> {
  const url = new URL(apiUrl(config, "getUpdates"));
  if (offset !== null) {
    url.searchParams.set("offset", String(offset));
  }
  url.searchParams.set("timeout", "0");
  url.searchParams.set("allowed_updates", '["message","callback_query"]');

  const response = await transport(url.toString());
  const body = (await response.json()) as {
    ok: boolean;
    result?: Array<{
      update_id: number;
      message?: {
        text?: string;
        chat?: { id: number };
        reply_to_message?: { message_id: number };
      };
      callback_query?: {
        id: string;
        data?: string;
        message?: {
          message_id: number;
          chat?: { id: number };
        };
        from?: { id: number };
      };
    }>;
  };

  if (!body.ok || !Array.isArray(body.result)) {
    return [];
  }

  const replies: IncomingReply[] = [];
  for (const update of body.result) {
    // START_BLOCK_PARSE_MESSAGE
    if (update.message && typeof update.message.text === "string" && typeof update.message.chat?.id === "number") {
      if (String(update.message.chat.id) === String(config.chatId)) {
        replies.push({
          updateId: update.update_id,
          text: update.message.text.trim(),
          chatId: String(update.message.chat.id),
          fromMessageId: update.message.reply_to_message?.message_id,
        });
      }
      continue;
    }
    // END_BLOCK_PARSE_MESSAGE

    // START_BLOCK_PARSE_CALLBACK
    const cb = update.callback_query;
    if (!cb || typeof cb.data !== "string") {
      continue;
    }
    const cbChatId = cb.message?.chat?.id;
    if (typeof cbChatId !== "number" || String(cbChatId) !== String(config.chatId)) {
      continue;
    }
    replies.push({
      updateId: update.update_id,
      text: cb.data.trim(),
      chatId: String(cbChatId),
      fromMessageId: cb.message?.message_id,
      callbackQueryId: cb.id,
    });
    // END_BLOCK_PARSE_CALLBACK
  }

  return replies;
}

/**
 * Match an incoming reply to an outstanding question.
 *
 * Priority:
 * 1. Reply `reply_to_message` or callback-source message points at our correlation message id.
 * 2. Callback data matches the `<correlationId>:<verb>` shape.
 * 3. First whitespace-separated token of a text reply equals the correlation id.
 * 4. Otherwise not matched.
 */
export function matchReply(reply: IncomingReply, correlationMessageId: number, correlationId: string) {
  if (reply.fromMessageId === correlationMessageId) {
    return true;
  }
  if (reply.callbackQueryId && reply.text.toLowerCase().startsWith(correlationId.toLowerCase() + ":")) {
    return true;
  }
  const firstToken = reply.text.split(/\s+/)[0]?.toLowerCase() ?? "";
  return firstToken === correlationId.toLowerCase();
}

/**
 * Normalize an answer into a decision verb that /afk understands.
 * Accepts: A/B/C/D/E, proceed, stop, evolve, defer (case-insensitive).
 *
 * Strict classification to prevent false positives on free-form text. Under the previous
 * "any token matches" rule, replies like "do not STOP", "I think we should PROCEED", or
 * "a cat" were all misclassified. The new rules:
 *
 *   1. Reject if the reply has more than 3 alphabetic tokens (free-form, not a short answer).
 *   2. Reject if any negation token (NO/NOT/DONT/NEVER/CANCEL) appears — ambiguous.
 *   3. Exactly one token must match the known verb/letter set.
 *   4. Single-letter matches (A-E) must be the only token (avoid "a cat" -> A).
 *
 * When in doubt, return UNKNOWN so the agent falls back to `grace afk defer` rather than
 * acting on a guessed classification for a one-way-door decision.
 */
const NEGATION_TOKENS = new Set(["NO", "NOT", "DONT", "NEVER", "CANCEL"]);
const KNOWN_LETTERS = new Set(["A", "B", "C", "D", "E"]);
const KNOWN_VERBS = new Set(["PROCEED", "STOP", "EVOLVE", "DEFER"]);
// DETAILS is recognised but NOT terminal: callers must treat it as "show the breakdown and
// keep polling". The classifier just returns it; the caller decides what to do.
const META_VERBS = new Set(["DETAILS"]);

export function classifyAnswer(text: string): { verb: string; raw: string; recognized: boolean } {
  const trimmed = text.trim();
  const reject = () => ({ verb: "UNKNOWN", raw: trimmed, recognized: false });

  // Inline-button callback payloads arrive as "<corrId>:<verb>". If we detect the shape,
  // classify the verb portion unambiguously and skip the fuzzy token-scan rules below.
  const callbackMatch = /^[a-f0-9]{3,12}:([A-Za-z]+)$/.exec(trimmed);
  if (callbackMatch) {
    const verb = callbackMatch[1]!.toUpperCase();
    if (KNOWN_LETTERS.has(verb) || KNOWN_VERBS.has(verb) || META_VERBS.has(verb)) {
      return { verb, raw: trimmed, recognized: true };
    }
    return reject();
  }

  const tokens = trimmed
    .split(/\s+/)
    .map((token) => token.toUpperCase().replace(/[^A-Z]/g, ""))
    .filter(Boolean);

  if (tokens.length === 0 || tokens.length > 3) {
    return reject();
  }

  const hasNegation = tokens.some((token) => NEGATION_TOKENS.has(token));
  const matches = tokens.filter((token) => KNOWN_LETTERS.has(token) || KNOWN_VERBS.has(token));

  if (hasNegation || matches.length !== 1) {
    return reject();
  }

  const match = matches[0]!;
  if (KNOWN_LETTERS.has(match) && tokens.length !== 1) {
    return reject();
  }

  return { verb: match, raw: trimmed, recognized: true };
}

// START_CHANGE_SUMMARY
//   LAST_CHANGE: [3.7.0-grace-afk] Initial module. Plain text only (no parse_mode: Markdown) —
//                title/context/options strings from development-plan.xml are user-controlled and
//                must not be able to inject markdown links or break formatting. Strict
//                classifyAnswer rejects multi-token, negated, or letter-in-free-text replies.
// END_CHANGE_SUMMARY
