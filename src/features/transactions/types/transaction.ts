/**
 * Transactions feature re-exports the shared transaction spine.
 * Future posting orchestration belongs in this feature's services.
 */

export type {
  StockBatch,
  StockMovement,
  StockMovementType,
  Transaction,
  TransactionReferenceType,
  TransactionStatus,
  TransactionType,
} from "@/types/transactions";
