import { memo } from "react";

type ReportingDashboardCardProps = {
  title: string;
  children: React.ReactNode;
  /**
   * Heading element for the card title.
   * Metrics nested under section widgets use "p" to preserve heading order.
   */
  titleAs?: "h3" | "p";
  /**
   * Optional accessible name for the metric article.
   * When set, the visible title is presentational to avoid duplicate announcements.
   */
  ariaLabel?: string;
};

const CARD_CLASS_NAME =
  "min-w-0 rounded-xl border border-zinc-200 bg-zinc-50/80 p-5 shadow-sm transition-shadow hover:bg-white hover:shadow-md sm:p-6";
const TITLE_CLASS_NAME =
  "text-xs font-medium uppercase tracking-wide text-zinc-500 sm:text-sm";
const BODY_CLASS_NAME = "mt-3 min-w-0 text-zinc-900 sm:mt-4";

/**
 * Presentational metric card shell nested inside the dashboard panel.
 */
export const ReportingDashboardCard = memo(function ReportingDashboardCard({
  title,
  children,
  titleAs = "h3",
  ariaLabel,
}: ReportingDashboardCardProps) {
  const TitleTag = titleAs;

  return (
    <article aria-label={ariaLabel} className={CARD_CLASS_NAME}>
      <TitleTag
        className={TITLE_CLASS_NAME}
        aria-hidden={ariaLabel ? true : undefined}
      >
        {title}
      </TitleTag>
      <div className={BODY_CLASS_NAME}>{children}</div>
    </article>
  );
});
