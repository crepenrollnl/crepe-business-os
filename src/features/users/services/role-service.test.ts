/**
 * Service-level coverage for role mutations and reads (DEV-049).
 *
 * createRole must go only through create_role RPC.
 * getRoles is a read-only select from roles (no list RPC, no writes).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_NAME_LENGTH } from "@/constants/limits";

const { supabaseMock } = vi.hoisted(() => {
  const supabaseMock = {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: {
      getUser: vi.fn(),
    },
  };
  return { supabaseMock };
});

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

import { roleService } from "./role-service";
import type { CreateRoleResult, Role } from "../types/user";

const ROLE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const AUTH_USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MAX_ROLE_CODE_LENGTH = 64;
const ROLES_SELECT = "id, code, name, created_at";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

function roleRow(overrides?: Partial<Role>): Role {
  return {
    id: ROLE_ID,
    code: "manager",
    name: "Manager",
    created_at: "2026-07-25T10:00:00.000Z",
    ...overrides,
  };
}

function mockRolesList(rows: Role[], error: unknown = null) {
  const orderSecond = vi.fn().mockResolvedValue({
    data: error ? null : rows,
    error,
  });
  const orderFirst = vi.fn().mockReturnValue({
    order: orderSecond,
  });
  const selectMock = vi.fn().mockReturnValue({
    order: orderFirst,
  });

  supabaseMock.from.mockImplementation((table: string) => {
    if (table !== "roles") {
      throw new Error(`Unexpected table: ${table}`);
    }

    return {
      select: selectMock,
      insert: insertMock,
      update: updateMock,
      delete: deleteMock,
    };
  });

  return { selectMock, orderFirst, orderSecond };
}

describe("roleService (DEV-049)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReset();
    updateMock.mockReset();
    deleteMock.mockReset();
    supabaseMock.from.mockImplementation(() => ({
      select: vi.fn(),
      insert: insertMock,
      update: updateMock,
      delete: deleteMock,
    }));
    supabaseMock.auth.getUser.mockResolvedValue({
      data: { user: { id: AUTH_USER_ID } },
      error: null,
    });
  });

  describe("createRole", () => {
    it("rejects missing code without calling the RPC", async () => {
      const result = await roleService.createRole({
        code: "   ",
        name: "Manager",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Role code is required.");
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
      expect(supabaseMock.from).not.toHaveBeenCalled();
      expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
    });

    it("rejects oversized code without calling the RPC", async () => {
      const result = await roleService.createRole({
        code: "a".repeat(MAX_ROLE_CODE_LENGTH + 1),
        name: "Manager",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        `Role code must be ${MAX_ROLE_CODE_LENGTH} characters or fewer.`,
      );
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("rejects missing name without calling the RPC", async () => {
      const result = await roleService.createRole({
        code: "manager",
        name: "   ",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Role name is required.");
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("rejects oversized name without calling the RPC", async () => {
      const result = await roleService.createRole({
        code: "manager",
        name: "A".repeat(MAX_NAME_LENGTH + 1),
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        `Role name must be ${MAX_NAME_LENGTH} characters or fewer.`,
      );
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("requires authentication before calling the RPC", async () => {
      supabaseMock.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const result = await roleService.createRole({
        code: "manager",
        name: "Manager",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("You must be signed in to create a role.");
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it("creates a role successfully and returns a typed result", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: {
          role_id: ROLE_ID,
          code: "manager",
        },
        error: null,
      });

      const result = await roleService.createRole({
        code: "  manager  ",
        name: "  Manager  ",
      });

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        roleId: ROLE_ID,
        code: "manager",
      } satisfies CreateRoleResult);
      expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
      expect(supabaseMock.rpc).toHaveBeenCalledWith("create_role", {
        p_code: "manager",
        p_name: "Manager",
      });
      expect(supabaseMock.from).not.toHaveBeenCalled();
      expect(insertMock).not.toHaveBeenCalled();
      expect(updateMock).not.toHaveBeenCalled();
      expect(deleteMock).not.toHaveBeenCalled();
    });

    it("maps duplicate role code RPC errors", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: {
          message: "Role with this code already exists.",
        },
      });

      const result = await roleService.createRole({
        code: "manager",
        name: "Manager",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("A role with this code already exists.");
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it("maps missing create_role function errors", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: {
          message: "Could not find the function public.create_role",
        },
      });

      const result = await roleService.createRole({
        code: "manager",
        name: "Manager",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "Role management is not available yet. Apply the users & roles database script and try again.",
      );
    });

    it("rejects invalid RPC payload", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: { role_id: "not-a-uuid", code: "manager" },
        error: null,
      });

      const result = await roleService.createRole({
        code: "manager",
        name: "Manager",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Role created but the response was invalid.");
    });
  });

  describe("getRoles", () => {
    it("returns an empty role list", async () => {
      const { selectMock, orderFirst, orderSecond } = mockRolesList([]);

      const result = await roleService.getRoles();

      expect(result.error).toBeNull();
      expect(result.data).toEqual([] satisfies Role[]);
      expect(supabaseMock.from).toHaveBeenCalledWith("roles");
      expect(selectMock).toHaveBeenCalledWith(ROLES_SELECT);
      expect(orderFirst).toHaveBeenCalledWith("name", { ascending: true });
      expect(orderSecond).toHaveBeenCalledWith("code", { ascending: true });
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
      expect(insertMock).not.toHaveBeenCalled();
      expect(updateMock).not.toHaveBeenCalled();
      expect(deleteMock).not.toHaveBeenCalled();
    });

    it("returns typed roles from a read-only select", async () => {
      const rows = [
        roleRow({
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          code: "cashier",
          name: "Cashier",
        }),
        roleRow({ code: "manager", name: "Manager" }),
      ];
      const { selectMock } = mockRolesList(rows);

      const result = await roleService.getRoles();

      expect(result.error).toBeNull();
      expect(result.data).toEqual(rows satisfies Role[]);
      expect(selectMock).toHaveBeenCalledWith(ROLES_SELECT);
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
      expect(insertMock).not.toHaveBeenCalled();
      expect(updateMock).not.toHaveBeenCalled();
      expect(deleteMock).not.toHaveBeenCalled();
    });

    it("is read-only and never writes roles", async () => {
      mockRolesList([roleRow()]);

      await roleService.getRoles();

      expect(supabaseMock.from).toHaveBeenCalledTimes(1);
      expect(supabaseMock.from).toHaveBeenCalledWith("roles");
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
      expect(insertMock).not.toHaveBeenCalled();
      expect(updateMock).not.toHaveBeenCalled();
      expect(deleteMock).not.toHaveBeenCalled();
    });

    it("maps missing roles table errors", async () => {
      mockRolesList([], {
        message: 'relation "roles" does not exist',
      });

      const result = await roleService.getRoles();

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "Role management is not available yet. Apply the users & roles database script and try again.",
      );
    });
  });

  it("never writes roles directly on createRole", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: {
        role_id: ROLE_ID,
        code: "manager",
      },
      error: null,
    });

    await roleService.createRole({
      code: "manager",
      name: "Manager",
    });

    expect(supabaseMock.rpc.mock.calls.map((call) => call[0])).toEqual([
      "create_role",
    ]);
    expect(supabaseMock.from).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });
});
