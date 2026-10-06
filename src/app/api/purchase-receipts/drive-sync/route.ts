import { createClient } from "@supabase/supabase-js";
import { canManagePurchaseReceipts } from "@/features/purchases/types/purchase-receipt";
import { readGoogleDriveSecrets } from "@/features/purchases/server/google-drive-secrets";
import { copyReceiptPagesToDrive } from "@/features/purchases/server/sync-purchase-receipt-drive";

export const runtime = "nodejs";
export const maxDuration = 60;

const SAFE_FAILURE = "Could not copy receipts to Drive.";

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

async function readFileIds(request: Request): Promise<string[] | null> {
  const text = await request.text();
  if (text.trim().length === 0) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RequestBodyError();
  }
  if (!parsed || typeof parsed !== "object" || !("fileIds" in parsed)) {
    return null;
  }
  const fileIds = parsed.fileIds;
  if (fileIds === undefined) {
    return null;
  }
  if (!Array.isArray(fileIds) || fileIds.some((id) => typeof id !== "string" || id.length === 0)) {
    throw new RequestBodyError();
  }
  return fileIds;
}

class RequestBodyError extends Error {
  constructor() {
    super(SAFE_FAILURE);
    this.name = "RequestBodyError";
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const token = readBearer(request);
    if (!token) {
      return json({ error: SAFE_FAILURE }, 401);
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return json({ error: SAFE_FAILURE }, 500);
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const userResult = await supabase.auth.getUser(token);
    if (userResult.error || !userResult.data.user) {
      return json({ error: SAFE_FAILURE }, 401);
    }

    const roleResult = await supabase.rpc("get_my_role");
    const role = typeof roleResult.data === "string" ? roleResult.data.trim() : "";
    if (roleResult.error || !canManagePurchaseReceipts(role)) {
      return json({ error: SAFE_FAILURE }, 403);
    }

    const secrets = readGoogleDriveSecrets();
    if (!secrets) {
      return json({ configured: false }, 200);
    }

    const fileIds = await readFileIds(request);
    const counts = await copyReceiptPagesToDrive(supabase, secrets, fileIds, token);
    return json({ configured: true, ...counts }, 200);
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return json({ error: SAFE_FAILURE }, 400);
    }
    return json({ error: SAFE_FAILURE }, 500);
  }
}
