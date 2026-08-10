/**
 * Service-level coverage for customer mutations (DEV-039).
 *
 * Create / update / deactivate must go only through SQL RPCs.
 * The service must not generate customer codes or write customers tables directly.
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

import { customerService } from "./customer-service";
import type {
  CreateCustomerResult,
  DeactivateCustomerResult,
  UpdateCustomerResult,
} from "../types/customer";

const CUSTOMER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CUSTOMER_CODE = "C-000001";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

describe("customerService (DEV-039)", () => {
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
      data: { user: { id: USER_ID } },
      error: null,
    });
  });

  describe("createCustomer", () => {
    it("rejects missing name without calling the RPC", async () => {
      const result = await customerService.createCustomer({ name: "   " });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Customer name is required.");
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
      expect(supabaseMock.from).not.toHaveBeenCalled();
      expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
    });

    it("rejects oversized name without calling the RPC", async () => {
      const result = await customerService.createCustomer({
        name: "A".repeat(MAX_NAME_LENGTH + 1),
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        `Customer name must be ${MAX_NAME_LENGTH} characters or fewer.`,
      );
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("requires authentication before calling the RPC", async () => {
      supabaseMock.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const result = await customerService.createCustomer({
        name: "Crepe Catering",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("You must be signed in to create a customer.");
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it("creates a customer successfully and returns a typed result", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: {
          customer_id: CUSTOMER_ID,
          code: CUSTOMER_CODE,
        },
        error: null,
      });

      const result = await customerService.createCustomer({
        name: "  Crepe Catering  ",
        email: "  hello@crepe.test  ",
        phone: " ",
        vat_number: null,
        notes: " VIP ",
      });

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        customerId: CUSTOMER_ID,
        code: CUSTOMER_CODE,
      } satisfies CreateCustomerResult);
      expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
      expect(supabaseMock.rpc).toHaveBeenCalledWith("create_customer", {
        p_name: "Crepe Catering",
        p_email: "hello@crepe.test",
        p_phone: null,
        p_vat_number: null,
        p_notes: "VIP",
      });
      expect(supabaseMock.from).not.toHaveBeenCalled();
      expect(insertMock).not.toHaveBeenCalled();
      expect(updateMock).not.toHaveBeenCalled();
      expect(deleteMock).not.toHaveBeenCalled();
    });

    it("maps duplicate customer code RPC errors", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: {
          message:
            'duplicate key value violates unique constraint "customers_code_key"',
        },
      });

      const result = await customerService.createCustomer({
        name: "Crepe Catering",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "Could not generate a unique customer code. Try again.",
      );
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it("maps missing create_customer function errors", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: {
          message: "Could not find the function public.create_customer",
        },
      });

      const result = await customerService.createCustomer({
        name: "Crepe Catering",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "Customer management is not available yet. Apply the customers database script and try again.",
      );
    });

    it("rejects invalid RPC payload", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: { customer_id: "not-a-uuid", code: CUSTOMER_CODE },
        error: null,
      });

      const result = await customerService.createCustomer({
        name: "Crepe Catering",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Customer created but the response was invalid.");
    });
  });

  describe("updateCustomer", () => {
    it("rejects invalid customer id without calling the RPC", async () => {
      const result = await customerService.updateCustomer({
        customer_id: "bad-id",
        name: "Updated",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Customer id is required.");
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
      expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
    });

    it("rejects blank name without calling the RPC", async () => {
      const result = await customerService.updateCustomer({
        customer_id: CUSTOMER_ID,
        name: "   ",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Customer name is required.");
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("updates a customer successfully and returns a typed result", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: { customer_id: CUSTOMER_ID },
        error: null,
      });

      const result = await customerService.updateCustomer({
        customer_id: CUSTOMER_ID,
        name: "Updated Name",
        email: "new@crepe.test",
        phone: null,
        vat_number: undefined,
        notes: "",
      });

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        customerId: CUSTOMER_ID,
      } satisfies UpdateCustomerResult);
      expect(supabaseMock.rpc).toHaveBeenCalledWith("update_customer", {
        p_customer_id: CUSTOMER_ID,
        p_name: "Updated Name",
        p_email: "new@crepe.test",
        p_phone: null,
        p_vat_number: null,
        p_notes: "",
      });
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it("maps not-found RPC errors", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: {
          message: "Customer was not found.",
        },
      });

      const result = await customerService.updateCustomer({
        customer_id: CUSTOMER_ID,
        name: "Updated Name",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Customer was not found.");
    });
  });

  describe("deactivateCustomer", () => {
    it("rejects invalid customer id without calling the RPC", async () => {
      const result = await customerService.deactivateCustomer("");

      expect(result.data).toBeNull();
      expect(result.error).toBe("Customer id is required.");
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("deactivates a customer successfully and returns a typed result", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: {
          customer_id: CUSTOMER_ID,
          is_active: false,
          already_inactive: false,
        },
        error: null,
      });

      const result = await customerService.deactivateCustomer(CUSTOMER_ID);

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        customerId: CUSTOMER_ID,
        isActive: false,
        alreadyInactive: false,
      } satisfies DeactivateCustomerResult);
      expect(supabaseMock.rpc).toHaveBeenCalledWith("deactivate_customer", {
        p_customer_id: CUSTOMER_ID,
      });
      expect(supabaseMock.from).not.toHaveBeenCalled();
      expect(updateMock).not.toHaveBeenCalled();
    });

    it("returns alreadyInactive when SQL reports the customer is inactive", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: {
          customer_id: CUSTOMER_ID,
          is_active: false,
          already_inactive: true,
        },
        error: null,
      });

      const result = await customerService.deactivateCustomer(CUSTOMER_ID);

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        customerId: CUSTOMER_ID,
        isActive: false,
        alreadyInactive: true,
      } satisfies DeactivateCustomerResult);
    });

    it("maps not-found RPC errors", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: {
          message: "Customer was not found.",
        },
      });

      const result = await customerService.deactivateCustomer(CUSTOMER_ID);

      expect(result.data).toBeNull();
      expect(result.error).toBe("Customer was not found.");
    });
  });

  it("never writes customers directly or generates codes in TypeScript", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: {
        customer_id: CUSTOMER_ID,
        code: CUSTOMER_CODE,
      },
      error: null,
    });

    await customerService.createCustomer({ name: "Crepe Catering" });

    expect(supabaseMock.rpc.mock.calls.map((call) => call[0])).toEqual([
      "create_customer",
    ]);
    expect(supabaseMock.from).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });
});
