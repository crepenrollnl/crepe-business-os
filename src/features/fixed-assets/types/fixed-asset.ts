/**
 * Fixed Assets & Straight-Line Depreciation contracts (Critical Finding #3,
 * Phase E, step 2).
 */

export interface FixedAsset {
  id: string;
  name: string;
  purchase_date: string;
  cost: number;
  useful_life_months: number;
  is_active: boolean;
  created_at: string;
}

export interface FixedAssetWithDepreciation extends FixedAsset {
  depreciated_amount: number;
  remaining_value: number;
}

export interface RegisterFixedAssetInput {
  name: string;
  purchaseDate: string;
  cost: number;
  usefulLifeMonths: number;
}

export interface DepreciationRunDetail {
  fixedAssetId: string;
  period: string;
  amount: number;
  postingNumber: string;
}

export interface DepreciationRunSkipped {
  fixedAssetId: string;
  reason: string;
}

export interface RunDepreciationResult {
  entriesCreated: number;
  totalAmount: number;
  details: DepreciationRunDetail[];
  skipped: DepreciationRunSkipped[];
}
