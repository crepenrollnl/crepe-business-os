/**
 * Suppliers domain contracts (DEV-040).
 *
 * Write path: create_supplier / update_supplier / deactivate_supplier RPCs.
 * Code generation and is_active rules live in SQL only.
 */

export interface Supplier {
  id: string;
  code: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  vat_number: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

/**
 * createSupplier input.
 * SQL create_supplier owns insert + code generation.
 */
export interface CreateSupplierInput {
  name: string;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  vat_number?: string | null;
  notes?: string | null;
}

/**
 * createSupplier result from create_supplier RPC.
 */
export interface CreateSupplierResult {
  supplierId: string;
  code: string;
}

/**
 * updateSupplier input.
 * Undefined / null fields are left unchanged by SQL (except blank strings clear nullable columns).
 */
export interface UpdateSupplierInput {
  supplier_id: string;
  name?: string | null;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  vat_number?: string | null;
  notes?: string | null;
}

/**
 * updateSupplier result from update_supplier RPC.
 */
export interface UpdateSupplierResult {
  supplierId: string;
}

/**
 * deactivateSupplier result from deactivate_supplier RPC.
 */
export interface DeactivateSupplierResult {
  supplierId: string;
  isActive: false;
  alreadyInactive: boolean;
}

export type { ServiceResult } from "@/types/service";
