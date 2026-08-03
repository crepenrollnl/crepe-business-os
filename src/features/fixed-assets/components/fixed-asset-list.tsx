import type { FixedAssetWithDepreciation } from "../types/fixed-asset";

interface FixedAssetListProps {
  assets: FixedAssetWithDepreciation[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

function FixedAssetListSkeleton() {
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

function FixedAssetListEmptyState() {
  return (
    <tr>
      <td colSpan={5} className="px-4 py-16 text-center">
        <p className="text-base font-medium text-zinc-900">No fixed assets yet</p>
        <p className="mt-2 text-sm text-zinc-500">
          Assets you register above will appear here.
        </p>
      </td>
    </tr>
  );
}

function formatDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatEuro(value: number): string {
  return `€${value.toFixed(2)}`;
}

function FixedAssetRow({ asset }: { asset: FixedAssetWithDepreciation }) {
  return (
    <tr className="border-t border-zinc-200">
      <td className="px-4 py-4 text-sm text-zinc-900">{asset.name}</td>
      <td className="px-4 py-4 text-sm text-zinc-700">
        {formatDate(asset.purchase_date)}
      </td>
      <td className="px-4 py-4 text-right text-sm text-zinc-700">
        {formatEuro(asset.cost)}
      </td>
      <td className="px-4 py-4 text-right text-sm text-zinc-700">
        {formatEuro(asset.depreciated_amount)}
      </td>
      <td className="px-4 py-4 text-right text-sm font-medium text-zinc-900">
        {formatEuro(asset.remaining_value)}
      </td>
    </tr>
  );
}

export function FixedAssetList({
  assets,
  loading,
  error,
  onRetry,
}: FixedAssetListProps) {
  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
        <p className="text-base font-medium text-red-800">
          Failed to load fixed assets
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
                Name
              </th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">
                Purchase Date
              </th>
              <th className="px-4 py-3 text-right text-sm font-semibold text-zinc-700">
                Cost
              </th>
              <th className="px-4 py-3 text-right text-sm font-semibold text-zinc-700">
                Depreciated
              </th>
              <th className="px-4 py-3 text-right text-sm font-semibold text-zinc-700">
                Remaining
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <FixedAssetListSkeleton />
            ) : assets.length === 0 ? (
              <FixedAssetListEmptyState />
            ) : (
              assets.map((asset) => <FixedAssetRow key={asset.id} asset={asset} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
