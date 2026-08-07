import { formatDate } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import type { ExpenseEntryWithRelations } from "../types/expense";

interface ExpenseListProps {
  expenses: ExpenseEntryWithRelations[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

function ExpenseListSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, index) => (
        <tr key={index} className="border-t border-zinc-200">
          {Array.from({ length: 5 }).map((__, cellIndex) => (
            <td key={cellIndex} className="px-4 py-4">
              <div className="h-4 animate-pulse rounded bg-zinc-200" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function ExpenseListEmptyState() {
  return (
    <tr>
      <td colSpan={5} className="px-4 py-16 text-center">
        <p className="text-base font-medium text-zinc-900">No expenses yet</p>
        <p className="mt-2 text-sm text-zinc-500">
          Expenses you record above will appear here.
        </p>
      </td>
    </tr>
  );
}

function ExpenseRow({ expense }: { expense: ExpenseEntryWithRelations }) {
  return (
    <tr className="border-t border-zinc-200">
      <td className="px-4 py-4 text-sm text-zinc-700">
        {formatDate(expense.expense_date)}
      </td>
      <td className="px-4 py-4 text-sm text-zinc-900">
        {expense.account
          ? `${expense.account.code} — ${expense.account.name}`
          : "—"}
      </td>
      <td className="px-4 py-4 text-sm text-zinc-700">
        {expense.supplier ?? "—"}
      </td>
      <td className="px-4 py-4 text-right text-sm font-medium text-zinc-900">
        {formatMoney(expense.gross_amount)}
      </td>
      <td className="px-4 py-4 text-right text-sm">
        {expense.posting_number ? (
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
            {expense.posting_number}
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-500">
            Not posted
          </span>
        )}
      </td>
    </tr>
  );
}

export function ExpenseList({
  expenses,
  loading,
  error,
  onRetry,
}: ExpenseListProps) {
  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
        <p className="text-base font-medium text-red-800">
          Failed to load expenses
        </p>
        <p className="mt-2 text-sm text-red-600">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead className="bg-zinc-50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">
                Date
              </th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">
                Category
              </th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">
                Supplier
              </th>
              <th className="px-4 py-3 text-right text-sm font-semibold text-zinc-700">
                Gross Amount
              </th>
              <th className="px-4 py-3 text-right text-sm font-semibold text-zinc-700">
                Posting
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <ExpenseListSkeleton />
            ) : expenses.length === 0 ? (
              <ExpenseListEmptyState />
            ) : (
              expenses.map((expense) => (
                <ExpenseRow key={expense.id} expense={expense} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
