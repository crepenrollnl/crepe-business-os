/**
 * Customers domain contracts (DEV-039).
 *
 * Write path: create_customer / update_customer / deactivate_customer RPCs.
 * Code generation and is_active rules live in SQL only.
 */

export interface Customer {
  id: string;
  code: string;
  name: string;
  email: string | null;
  phone: string | null;
  vat_number: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

/**
 * createCustomer input.
 * SQL create_customer owns insert + code generation.
 */
export interface CreateCustomerInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  vat_number?: string | null;
  notes?: string | null;
}

/**
 * createCustomer result from create_customer RPC.
 */
export interface CreateCustomerResult {
  customerId: string;
  code: string;
}

/**
 * updateCustomer input.
 * Undefined / null fields are left unchanged by SQL (except blank strings clear nullable columns).
 */
export interface UpdateCustomerInput {
  customer_id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  vat_number?: string | null;
  notes?: string | null;
}

/**
 * updateCustomer result from update_customer RPC.
 */
export interface UpdateCustomerResult {
  customerId: string;
}

/**
 * deactivateCustomer result from deactivate_customer RPC.
 */
export interface DeactivateCustomerResult {
  customerId: string;
  isActive: false;
  alreadyInactive: boolean;
}

export type { ServiceResult } from "@/types/service";
