/**
 * Events domain contracts for catering, markets, and service days.
 */

export type EventStatus = "planned" | "active" | "completed" | "cancelled";

export interface BusinessEvent {
  id: string;
  name: string;
  status: EventStatus;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  customer_id: string | null;
  notes: string | null;
  created_at: string;
}
