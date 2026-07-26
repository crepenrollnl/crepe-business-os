/**
 * Service-level coverage for user mutations (DEV-049).
 *
 * Create / update / deactivate / assign_role must go only through SQL RPCs.
 * The service must not write users or user_roles tables directly.
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

import { userService } from "./user-service";
import type {
  AssignRoleResult,
  CreateUserResult,
  DeactivateUserResult,
  UpdateUserResult,
} from "../types/user";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AUTH_USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ROLE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ROLE_ID_2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const MAX_EMAIL_LENGTH = 254;

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

describe("userService (DEV-049)", () => {
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

  describe("createUser", () => {
    it("rejects missing full name without calling the RPC", async () => {
      const result = await userService.createUser({
        full_name: "   ",
        email: "chef@crepe.test",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("User full name is required.");
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
      expect(supabaseMock.from).not.toHaveBeenCalled();
      expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
    });

    it("rejects oversized full name without calling the RPC", async () => {
      const result = await userService.createUser({
        full_name: "A".repeat(MAX_NAME_LENGTH + 1),
        email: "chef@crepe.test",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        `User full name must be ${MAX_NAME_LENGTH} characters or fewer.`,
      );
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("rejects missing email without calling the RPC", async () => {
      const result = await userService.createUser({
        full_name: "Kitchen Chef",
        email: "   ",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("User email is required.");
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("rejects oversized email without calling the RPC", async () => {
      const result = await userService.createUser({
        full_name: "Kitchen Chef",
        email: `${"a".repeat(MAX_EMAIL_LENGTH)}@x.test`,
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        `User email must be ${MAX_EMAIL_LENGTH} characters or fewer.`,
      );
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("requires authentication before calling the RPC", async () => {
      supabaseMock.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const result = await userService.createUser({
        full_name: "Kitchen Chef",
        email: "chef@crepe.test",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("You must be signed in to create a user.");
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it("creates a user successfully and returns a typed result", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: { user_id: USER_ID },
        error: null,
      });

      const result = await userService.createUser({
        full_name: "  Kitchen Chef  ",
        email: "  chef@crepe.test  ",
      });

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        userId: USER_ID,
      } satisfies CreateUserResult);
      expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
      expect(supabaseMock.rpc).toHaveBeenCalledWith("create_user", {
        p_full_name: "Kitchen Chef",
        p_email: "chef@crepe.test",
      });
      expect(supabaseMock.from).not.toHaveBeenCalled();
      expect(insertMock).not.toHaveBeenCalled();
      expect(updateMock).not.toHaveBeenCalled();
      expect(deleteMock).not.toHaveBeenCalled();
    });

    it("maps duplicate email RPC errors", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: {
          message: "Email already exists.",
        },
      });

      const result = await userService.createUser({
        full_name: "Kitchen Chef",
        email: "chef@crepe.test",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("A user with this email already exists.");
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it("maps missing create_user function errors", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: {
          message: "Could not find the function public.create_user",
        },
      });

      const result = await userService.createUser({
        full_name: "Kitchen Chef",
        email: "chef@crepe.test",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "User management is not available yet. Apply the users & roles database script and try again.",
      );
    });

    it("rejects invalid RPC payload", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: { user_id: "not-a-uuid" },
        error: null,
      });

      const result = await userService.createUser({
        full_name: "Kitchen Chef",
        email: "chef@crepe.test",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("User created but the response was invalid.");
    });
  });

  describe("updateUser", () => {
    it("rejects invalid user id without calling the RPC", async () => {
      const result = await userService.updateUser({
        user_id: "bad-id",
        full_name: "Updated",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("User id is required.");
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
      expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
    });

    it("rejects blank full name without calling the RPC", async () => {
      const result = await userService.updateUser({
        user_id: USER_ID,
        full_name: "   ",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("User full name is required.");
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("rejects blank email without calling the RPC", async () => {
      const result = await userService.updateUser({
        user_id: USER_ID,
        email: "   ",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("User email is required.");
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("updates a user successfully and returns a typed result", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: { user_id: USER_ID },
        error: null,
      });

      const result = await userService.updateUser({
        user_id: USER_ID,
        full_name: "Updated Name",
        email: "new@crepe.test",
      });

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        userId: USER_ID,
      } satisfies UpdateUserResult);
      expect(supabaseMock.rpc).toHaveBeenCalledWith("update_user", {
        p_user_id: USER_ID,
        p_full_name: "Updated Name",
        p_email: "new@crepe.test",
      });
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it("passes null for omitted update fields", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: { user_id: USER_ID },
        error: null,
      });

      const result = await userService.updateUser({
        user_id: USER_ID,
        full_name: "Name Only",
      });

      expect(result.error).toBeNull();
      expect(supabaseMock.rpc).toHaveBeenCalledWith("update_user", {
        p_user_id: USER_ID,
        p_full_name: "Name Only",
        p_email: null,
      });
    });

    it("maps not-found RPC errors", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: {
          message: "User was not found.",
        },
      });

      const result = await userService.updateUser({
        user_id: USER_ID,
        full_name: "Updated Name",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("User was not found.");
    });

    it("maps duplicate email RPC errors", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: {
          message: "Email already exists.",
        },
      });

      const result = await userService.updateUser({
        user_id: USER_ID,
        email: "taken@crepe.test",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("A user with this email already exists.");
    });
  });

  describe("deactivateUser", () => {
    it("rejects invalid user id without calling the RPC", async () => {
      const result = await userService.deactivateUser("");

      expect(result.data).toBeNull();
      expect(result.error).toBe("User id is required.");
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("deactivates a user successfully and returns a typed result", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: {
          user_id: USER_ID,
          is_active: false,
          already_inactive: false,
        },
        error: null,
      });

      const result = await userService.deactivateUser(USER_ID);

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        userId: USER_ID,
        isActive: false,
        alreadyInactive: false,
      } satisfies DeactivateUserResult);
      expect(supabaseMock.rpc).toHaveBeenCalledWith("deactivate_user", {
        p_user_id: USER_ID,
      });
      expect(supabaseMock.from).not.toHaveBeenCalled();
      expect(updateMock).not.toHaveBeenCalled();
    });

    it("returns alreadyInactive when SQL reports the user is inactive", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: {
          user_id: USER_ID,
          is_active: false,
          already_inactive: true,
        },
        error: null,
      });

      const result = await userService.deactivateUser(USER_ID);

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        userId: USER_ID,
        isActive: false,
        alreadyInactive: true,
      } satisfies DeactivateUserResult);
    });

    it("maps not-found RPC errors", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: {
          message: "User was not found.",
        },
      });

      const result = await userService.deactivateUser(USER_ID);

      expect(result.data).toBeNull();
      expect(result.error).toBe("User was not found.");
    });

    it("rejects invalid RPC payload", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: {
          user_id: USER_ID,
          is_active: true,
          already_inactive: false,
        },
        error: null,
      });

      const result = await userService.deactivateUser(USER_ID);

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "User deactivated but the response was invalid.",
      );
    });
  });

  describe("assignRole", () => {
    it("rejects invalid user id without calling the RPC", async () => {
      const result = await userService.assignRole({
        user_id: "bad-id",
        role_id: ROLE_ID,
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("User id is required.");
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
      expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
    });

    it("rejects invalid role id without calling the RPC", async () => {
      const result = await userService.assignRole({
        user_id: USER_ID,
        role_id: "bad-id",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Role id is required.");
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("assigns a role successfully and returns a typed result", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: {
          user_id: USER_ID,
          role_id: ROLE_ID,
          role_code: "manager",
          already_assigned: false,
        },
        error: null,
      });

      const result = await userService.assignRole({
        user_id: USER_ID,
        role_id: ROLE_ID,
      });

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        userId: USER_ID,
        roleId: ROLE_ID,
        roleCode: "manager",
        alreadyAssigned: false,
      } satisfies AssignRoleResult);
      expect(supabaseMock.rpc).toHaveBeenCalledWith("assign_role", {
        p_user_id: USER_ID,
        p_role_id: ROLE_ID,
      });
      expect(supabaseMock.from).not.toHaveBeenCalled();
      expect(insertMock).not.toHaveBeenCalled();
    });

    it("returns alreadyAssigned when SQL reports the role is already linked", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: {
          user_id: USER_ID,
          role_id: ROLE_ID,
          role_code: "manager",
          already_assigned: true,
        },
        error: null,
      });

      const result = await userService.assignRole({
        user_id: USER_ID,
        role_id: ROLE_ID,
      });

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        userId: USER_ID,
        roleId: ROLE_ID,
        roleCode: "manager",
        alreadyAssigned: true,
      } satisfies AssignRoleResult);
    });

    it("assigns multiple roles to the same user via separate RPC calls", async () => {
      supabaseMock.rpc
        .mockResolvedValueOnce({
          data: {
            user_id: USER_ID,
            role_id: ROLE_ID,
            role_code: "manager",
            already_assigned: false,
          },
          error: null,
        })
        .mockResolvedValueOnce({
          data: {
            user_id: USER_ID,
            role_id: ROLE_ID_2,
            role_code: "cashier",
            already_assigned: false,
          },
          error: null,
        });

      const first = await userService.assignRole({
        user_id: USER_ID,
        role_id: ROLE_ID,
      });
      const second = await userService.assignRole({
        user_id: USER_ID,
        role_id: ROLE_ID_2,
      });

      expect(first.error).toBeNull();
      expect(second.error).toBeNull();
      expect(first.data).toEqual({
        userId: USER_ID,
        roleId: ROLE_ID,
        roleCode: "manager",
        alreadyAssigned: false,
      } satisfies AssignRoleResult);
      expect(second.data).toEqual({
        userId: USER_ID,
        roleId: ROLE_ID_2,
        roleCode: "cashier",
        alreadyAssigned: false,
      } satisfies AssignRoleResult);
      expect(supabaseMock.rpc.mock.calls.map((call) => call[0])).toEqual([
        "assign_role",
        "assign_role",
      ]);
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it("maps inactive-user RPC errors", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: {
          message: "Inactive users cannot be assigned roles.",
        },
      });

      const result = await userService.assignRole({
        user_id: USER_ID,
        role_id: ROLE_ID,
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Inactive users cannot be assigned roles.");
    });

    it("maps role-not-found RPC errors", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: {
          message: "Role was not found.",
        },
      });

      const result = await userService.assignRole({
        user_id: USER_ID,
        role_id: ROLE_ID,
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Role was not found.");
    });

    it("maps missing assign_role function errors", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: {
          message: "Could not find the function public.assign_role",
        },
      });

      const result = await userService.assignRole({
        user_id: USER_ID,
        role_id: ROLE_ID,
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "User management is not available yet. Apply the users & roles database script and try again.",
      );
    });
  });

  it("never writes users or user_roles directly", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: { user_id: USER_ID },
      error: null,
    });

    await userService.createUser({
      full_name: "Kitchen Chef",
      email: "chef@crepe.test",
    });

    expect(supabaseMock.rpc.mock.calls.map((call) => call[0])).toEqual([
      "create_user",
    ]);
    expect(supabaseMock.from).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });
});
