import "server-only";

const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const REQUEST_TIMEOUT_MS = 50_000;
const MAX_TOKENS = 4096;

export type SafeAiFailureKind = "unavailable" | "busy" | "unreadable";

/** Carries only a kind; the external response body is always discarded. */
export class SafeAiFailure extends Error {
  readonly kind: SafeAiFailureKind;

  constructor(kind: SafeAiFailureKind) {
    super(`Receipt reading failed (${kind}).`);
    this.name = "SafeAiFailure";
    this.kind = kind;
  }
}

export interface AnthropicImage {
  mediaType: string;
  base64: string;
}

export interface AnthropicMessageRequest {
  apiKey: string;
  model: string;
  system: string;
  images: AnthropicImage[];
  text: string;
  schema: unknown;
}

export interface AnthropicUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface AnthropicMessageResponse {
  text: string | null;
  stopReason: string | null;
  usage: AnthropicUsage;
}

export function failureKindForStatus(status: number): SafeAiFailureKind {
  if (status === 401 || status === 403) {
    return "unavailable";
  }
  if (status === 429 || status === 529 || status >= 500) {
    return "busy";
  }
  return "unreadable";
}

function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function readUsage(value: unknown): AnthropicUsage {
  if (!value || typeof value !== "object") {
    return { inputTokens: null, outputTokens: null };
  }
  const usage = value as Record<string, unknown>;
  return {
    inputTokens: tokenCount(usage.input_tokens),
    outputTokens: tokenCount(usage.output_tokens),
  };
}

function firstText(content: unknown): string | null {
  if (!Array.isArray(content)) {
    return null;
  }
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      (block as Record<string, unknown>).type === "text" &&
      typeof (block as Record<string, unknown>).text === "string"
    ) {
      return (block as { text: string }).text;
    }
  }
  return null;
}

function requestBody(request: AnthropicMessageRequest): string {
  return JSON.stringify({
    model: request.model,
    max_tokens: MAX_TOKENS,
    system: request.system,
    messages: [
      {
        role: "user",
        content: [
          ...request.images.map((image) => ({
            type: "image",
            source: { type: "base64", media_type: image.mediaType, data: image.base64 },
          })),
          { type: "text", text: request.text },
        ],
      },
    ],
    output_config: { format: { type: "json_schema", schema: request.schema } },
  });
}

export async function createAnthropicMessage(
  request: AnthropicMessageRequest,
): Promise<AnthropicMessageResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let payload: unknown;
  try {
    let response: Response;
    try {
      response = await fetch(MESSAGES_URL, {
        method: "POST",
        headers: {
          "x-api-key": request.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        body: requestBody(request),
        signal: controller.signal,
      });
    } catch {
      // Network error or timeout (abort).
      throw new SafeAiFailure("busy");
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new SafeAiFailure(failureKindForStatus(response.status));
    }

    try {
      payload = await response.json();
    } catch {
      throw new SafeAiFailure(controller.signal.aborted ? "busy" : "unreadable");
    }
  } finally {
    clearTimeout(timer);
  }

  const message = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  return {
    text: firstText(message.content),
    stopReason: typeof message.stop_reason === "string" ? message.stop_reason : null,
    usage: readUsage(message.usage),
  };
}
