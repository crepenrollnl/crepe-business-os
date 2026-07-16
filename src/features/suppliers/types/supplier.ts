/**
 * Suppliers module contract.
 *
 * Inventory currently uses a minimal supplier projection for lookups.
 * This file defines the fuller supplier master model for the dedicated module.
 */

export interface Supplier {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

export interface SupplierFormValues {
  name: string;
  email: string;
  phone: string;
  notes: string;
  is_active: boolean;
}
