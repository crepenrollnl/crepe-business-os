import { FinishedGoodsSearchBox } from "./finished-goods-search-box";

type FinishedGoodsToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
};

export function FinishedGoodsToolbar({
  search,
  onSearchChange,
}: FinishedGoodsToolbarProps) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
        <FinishedGoodsSearchBox value={search} onChange={onSearchChange} />
      </div>
    </div>
  );
}
