import { memo } from "react";

type ReportingSectionWidgetProps = {
  title: string;
  children: React.ReactNode;
};

const SECTION_CLASS_NAME = "space-y-3 sm:space-y-4";
const HEADER_CLASS_NAME = "border-b border-zinc-100 pb-2";
const TITLE_CLASS_NAME =
  "text-sm font-semibold tracking-tight text-zinc-900 sm:text-base";
const GRID_CLASS_NAME =
  "grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4";

/**
 * Presentational shell for one Reporting API overview section widget.
 */
export const ReportingSectionWidget = memo(function ReportingSectionWidget({
  title,
  children,
}: ReportingSectionWidgetProps) {
  return (
    <section aria-label={title} className={SECTION_CLASS_NAME}>
      <div className={HEADER_CLASS_NAME}>
        <h4 className={TITLE_CLASS_NAME}>{title}</h4>
      </div>
      <div
        className={GRID_CLASS_NAME}
        role="group"
        aria-label={`${title} metrics`}
      >
        {children}
      </div>
    </section>
  );
});
