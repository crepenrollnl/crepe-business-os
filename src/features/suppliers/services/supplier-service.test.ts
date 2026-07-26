/**
 * Service-level coverage for supplier mutations (DEV-040).
 *
 * Create / update / deactivate must go only through SQL RPCs.
 * The service must not generate supplier codes or write suppliers tables directly.
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

import { supplierService } from "./supplier-service";
import type {
  CreateSupplierResult,
  DeactivateSupplierResult,
  UpdateSupplierResult,
} from "../types/supplier";

const SUPPLIER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUPPLIER_CODE = "V-000001";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

describe("supplierService (DEV-040)", () => {
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

  describe("createSupplier", () => {
    it("rejects missing name without calling the RPC", async () => {
      const result = await supplierService.createSupplier({ name: "   " });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Supplier name is required.");
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
      expect(supabaseMock.from).not.toHaveBeenCalled();
      expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
    });

    it("rejects oversized name without calling the RPC", async () => {
      const result = await supplierService.createSupplier({
        name: "A".repeat(MAX_NAME_LENGTH + 1),
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        `Supplier name must be ${MAX_NAME_LENGTH} characters or fewer.`,
      );
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("requires authentication before calling the RPC", async () => {
      supabaseMock.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const result = await supplierService.createSupplier({
        name: "Dairy Supply Co",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("You must be signed in to create a supplier.");
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it("creates a supplier successfully and returns a typed result", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: {
          supplier_id: SUPPLIER_ID,
          code: SUPPLIER_CODE,
        },
        error: null,
      });

      const result = await supplierService.createSupplier({
        name: "  Dairy Supply Co  ",
        contact_name: "  Alex Vendor  ",
        email: "  hello@dairy.test  ",
        phone: " ",
        vat_number: null,
        notes: " Preferred ",
      });

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        supplierId: SUPPLIER_ID,
        code: SUPPLIER_CODE,
      } satisfies CreateSupplierResult);
      expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
      expect(supabaseMock.rpc).toHaveBeenCalledWith("create_supplier", {
        p_name: "Dairy Supply Co",
        p_contact_name: "Alex Vendor",
        p_email: "hello@dairy.test",
        p_phone: null,
        p_vat_number: null,
        p_notes: "Preferred",
      });
      expect(supabaseMock.from).not.toHaveBeenCalled();
      expect(insertMock).not.toHaveBeenCalled();
      expect(updateMock).not.toHaveBeenCalled();
      expect(deleteMock).not.toHaveBeenCalled();
    });

    it("maps duplicate supplier code RPC errors", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: {
          message:
            'duplicate key value violates unique constraint "suppliers_code_key"',
        },
      });

      const result = await supplierService.createSupplier({
        name: "Dairy Supply Co",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "Could not generate a unique supplier code. Try again.",
      );
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it("maps missing create_supplier function errors", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: {
          message: "Could not find the function public.create_supplier",
        },
      });

      const result = await supplierService.createSupplier({
        name: "Dairy Supply Co",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "Supplier management is not available yet. Apply the suppliers database script and try again.",
      );
    });

    it("rejects invalid RPC payload", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: { supplier_id: "not-a-uuid", code: SUPPLIER_CODE },
        error: null,
      });

      const result = await supplierService.createSupplier({
        name: "Dairy Supply Co",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Supplier created but the response was invalid.");
    });
  });

  describe("updateSupplier", () => {
    it("rejects invalid supplier id without calling the RPC", async () => {
      const result = await supplierService.updateSupplier({
        supplier_id: "bad-id",
        name: "Updated",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Supplier id is required.");
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
      expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
    });

    it("rejects blank name without calling the RPC", async () => {
      const result = await supplierService.updateSupplier({
        supplier_id: SUPPLIER_ID,
        name: "   ",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Supplier name is required.");
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("updates a supplier successfully and returns a typed result", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: { supplier_id: SUPPLIER_ID },
        error: null,
      });

      const result = await supplierService.updateSupplier({
        supplier_id: SUPPLIER_ID,
        name: "Updated Name",
        contact_name: "New Contact",
        email: "new@dairy.test",
        phone: null,
        vat_number: undefined,
        notes: "",
      });

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        supplierId: SUPPLIER_ID,
      } satisfies UpdateSupplierResult);
      expect(supabaseMock.rpc).toHaveBeenCalledWith("update_supplier", {
        p_supplier_id: SUPPLIER_ID,
        p_name: "Updated Name",
        p_contact_name: "New Contact",
        p_email: "new@dairy.test",
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
          message: "Supplier was not found.",
        },
      });

      const result = await supplierService.updateSupplier({
        supplier_id: SUPPLIER_ID,
        name: "Updated Name",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Supplier was not found.");
    });
  });

  describe("deactivateSupplier", () => {
    it("rejects invalid supplier id without calling the RPC", async () => {
      const result = await supplierService.deactivateSupplier("");

      expect(result.data).toBeNull();
      expect(result.error).toBe("Supplier id is required.");
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("deactivates a supplier successfully and returns a typed result", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: {
          supplier_id: SUPPLIER_ID,
          is_active: false,
          already_inactive: false,
        },
        error: null,
      });

      const result = await supplierService.deactivateSupplier(SUPPLIER_ID);

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        supplierId: SUPPLIER_ID,
        isActive: false,
        alreadyInactive: false,
      } satisfies DeactivateSupplierResult);
      expect(supabaseMock.rpc).toHaveBeenCalledWith("deactivate_supplier", {
        p_supplier_id: SUPPLIER_ID,
      });
      expect(supabaseMock.from).not.toHaveBeenCalled();
      expect(updateMock).not.toHaveBeenCalled();
    });

    it("returns alreadyInactive when SQL reports the supplier is inactive", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: {
          supplier_id: SUPPLIER_ID,
          is_active: false,
          already_inactive: true,
        },
        error: null,
      });

      const result = await supplierService.deactivateSupplier(SUPPLIER_ID);

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        supplierId: SUPPLIER_ID,
        isActive: false,
        alreadyInactive: true,
      } satisfies DeactivateSupplierResult);
    });

    it("maps not-found RPC errors", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: {
          message: "Supplier was not found.",
        },
      });

      const result = await supplierService.deactivateSupplier(SUPPLIER_ID);

      expect(result.data).toBeNull();
      expect(result.error).toBe("Supplier was not found.");
    });
  });

  it("never writes suppliers directly or generates codes in TypeScript", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: {
        supplier_id: SUPPLIER_ID,
        code: SUPPLIER_CODE,
      },
      error: null,
    });

    await supplierService.createSupplier({ name: "Dairy Supply Co" });

    expect(supabaseMock.rpc.mock.calls.map((call) => call[0])).toEqual([
      "create_supplier",
    ]);
    expect(supabaseMock.from).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });
});
