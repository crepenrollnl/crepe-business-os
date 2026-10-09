import { createClient } from "@supabase/supabase-js";
import { canManagePurchaseReceipts } from "@/features/purchases/types/purchase-receipt";
import { readReceiptAiConfig } from "@/features/purchases/server/receipt-ai-config";
import {
  READING_FAILED,
  recognizePurchaseReceipt,
} from "@/features/purchases/server/recognize-purchase-receipt";

export const runtime = "nodejs";
export const maxDuration = 60;

const NOT_ALLOWED = "Receipt reading is not allowed.";
const BAD_REQUEST = "Invalid receipt reading request.";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function methodNotAllowed(): Response {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

export function GET(): Response {
  return methodNotAllowed();
}

export function PUT(): Response {
  return methodNotAllowed();
}

export function PATCH(): Response {
  return methodNotAllowed();
}

export function DELETE(): Response {
  return methodNotAllowed();
}

function readBearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) {
    return null;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1] ?? null;
}

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

interface RecognizeRequest {
  receiptId: string;
  force: boolean;
}

async function readRequest(request: Request): Promise<RecognizeRequest | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await request.text());
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const body = parsed as Record<string, unknown>;
  if (typeof body.receiptId !== "string" || !UUID_PATTERN.test(body.receiptId)) {
    return null;
  }
  if (body.force !== undefined && typeof body.force !== "boolean") {
    return null;
  }
  return { receiptId: body.receiptId, force: body.force === true };
}

export async function POST(request: Request): Promise<Response> {
  try {
    const token = readBearer(request);
    if (!token) {
      return json({ error: NOT_ALLOWED }, 401);
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return json({ error: READING_FAILED }, 500);
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const userResult = await supabase.auth.getUser(token);
    if (userResult.error || !userResult.data.user) {
      return json({ error: NOT_ALLOWED }, 401);
    }

    const roleResult = await supabase.rpc("get_my_role");
    const role = typeof roleResult.data === "string" ? roleResult.data.trim() : "";
    if (roleResult.error || !canManagePurchaseReceipts(role)) {
      return json({ error: NOT_ALLOWED }, 403);
    }

    const body = await readRequest(request);
    if (!body) {
      return json({ error: BAD_REQUEST }, 400);
    }

    const config = readReceiptAiConfig();
    if (!config) {
      return json({ configured: false }, 200);
    }

    const outcome = await recognizePurchaseReceipt(
      supabase,
      config,
      body.receiptId,
      body.force,
    );
    if (!outcome.ok) {
      return json({ error: outcome.error }, outcome.status);
    }
    return json(
      {
        configured: true,
        cached: outcome.cached,
        recognitionId: outcome.recognitionId,
        model: outcome.model,
        result: outcome.result,
      },
      200,
    );
  } catch {
    return json({ error: READING_FAILED }, 500);
  }
}
