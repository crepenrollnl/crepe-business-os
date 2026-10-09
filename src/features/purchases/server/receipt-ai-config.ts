import "server-only";

export const DEFAULT_RECEIPT_AI_MODEL = "claude-sonnet-5-5";

const MODEL_PATTERN = /^[a-z0-9.-]{1,100}$/;

export interface ReceiptAiConfig {
  apiKey: string;
  model: string;
}

export function readReceiptAiConfig(): ReceiptAiConfig | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    return null;
  }
  const model = (process.env.RECEIPT_AI_MODEL ?? "").trim();
  return {
    apiKey,
    model: MODEL_PATTERN.test(model) ? model : DEFAULT_RECEIPT_AI_MODEL,
  };
}
