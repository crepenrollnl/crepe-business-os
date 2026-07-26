/**
 * Roles service (DEV-049).
 *
 * createRole uses create_role RPC.
 * getRoles reads the roles table (no list RPC).
 * Does NOT implement permissions, auth, JWT, or RLS.
 */

import { MAX_NAME_LENGTH } from "@/constants/limits";
import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  CreateRoleInput,
  CreateRoleResult,
  Role,
} from "../types/user";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ROLES_TABLE = "roles";
const ROLES_SELECT = "id, code, name, created_at";
const MAX_ROLE_CODE_LENGTH = 64;

interface RoleSqlRow {
  id: string;
  code: string;
  name: string;
  created_at: string;
}

function rpcErrorMessage(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }

  return typeof error === "string" ? error : null;
}

function validateCreateRoleInput(input: CreateRoleInput): string | null {
  const code = input.code?.trim() ?? "";
  if (code.length === 0) {
    return "Role code is required.";
  }
  if (code.length > MAX_ROLE_CODE_LENGTH) {
    return `Role code must be ${MAX_ROLE_CODE_LENGTH} characters or fewer.`;
  }

  const name = input.name?.trim() ?? "";
  if (name.length === 0) {
    return "Role name is required.";
  }
  if (name.length > MAX_NAME_LENGTH) {
    return `Role name must be ${MAX_NAME_LENGTH} characters or fewer.`;
  }

  return null;
}

function mapRoleRpcError(message: string): string | null {
  const normalized = message.toLowerCase();

  if (normalized.includes("role code is required")) {
    return "Role code is required.";
  }

  if (normalized.includes("role name is required")) {
    return "Role name is required.";
  }

  if (normalized.includes("role with this code already exists")) {
    return "A role with this code already exists.";
  }

  if (
    normalized.includes("could not find the function") ||
    (normalized.includes("create_role") &&
      (normalized.includes("schema cache") ||
        normalized.includes("does not exist") ||
        normalized.includes("42883")))
  ) {
    return "Role management is not available yet. Apply the users & roles database script and try again.";
  }

  if (
    normalized.includes("roles") &&
    (normalized.includes("does not exist") ||
      normalized.includes("schema cache") ||
      normalized.includes("42p01"))
  ) {
    return "Role management is not available yet. Apply the users & roles database script and try again.";
  }

  return null;
}

function mapRoleError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message = rpcErrorMessage(err);
      return message ? mapRoleRpcError(message) : null;
    },
  });
}

function mapCreateRoleRpcResult(data: unknown): CreateRoleResult | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const row = data as Record<string, unknown>;
  const roleId = row.role_id;
  const code = row.code;

  if (
    typeof roleId !== "string" ||
    !UUID_RE.test(roleId) ||
    typeof code !== "string" ||
    code.trim().length === 0
  ) {
    return null;
  }

  return {
    roleId,
    code,
  };
}

function mapRoleRow(row: RoleSqlRow): Role {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    created_at: row.created_at,
  };
}

async function requireSignedIn(
  actionLabel: string,
): Promise<ServiceResult<true>> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return fail(`You must be signed in to ${actionLabel}.`);
  }

  return ok(true);
}

export const roleService = {
  /**
   * Create a role via create_role RPC.
   */
  async createRole(
    input: CreateRoleInput,
  ): Promise<ServiceResult<CreateRoleResult>> {
    try {
      const validationError = validateCreateRoleInput(input);
      if (validationError) {
        return fail(validationError);
      }

      const auth = await requireSignedIn("create a role");
      if (auth.error) {
        return fail(auth.error);
      }

      const { data, error } = await supabase.rpc("create_role", {
        p_code: input.code.trim(),
        p_name: input.name.trim(),
      });

      if (error) {
        return fail(mapRoleError(error, "Failed to create role."));
      }

      const rpcResult = mapCreateRoleRpcResult(data);
      if (!rpcResult) {
        return fail("Role created but the response was invalid.");
      }

      return ok(rpcResult);
    } catch (error) {
      return fail(mapRoleError(error, "Failed to create role."));
    }
  },

  /**
   * List roles from the roles table (no list RPC).
   */
  async getRoles(): Promise<ServiceResult<Role[]>> {
    try {
      const { data, error } = await supabase
        .from(ROLES_TABLE)
        .select(ROLES_SELECT)
        .order("name", { ascending: true })
        .order("code", { ascending: true });

      if (error) {
        return fail(mapRoleError(error, "Failed to load roles"));
      }

      return ok(((data as RoleSqlRow[] | null) ?? []).map(mapRoleRow));
    } catch (error) {
      return fail(mapRoleError(error, "Failed to load roles"));
    }
  },
};
