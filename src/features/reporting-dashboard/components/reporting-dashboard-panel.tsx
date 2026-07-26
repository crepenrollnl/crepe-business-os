import { memo } from "react";

type ReportingDashboardPanelProps = {
  headingId: string;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
};

const PANEL_CLASS_NAME =
  "rounded-xl border border-zinc-200 bg-white shadow-sm";
const HEADER_CLASS_NAME = "border-b border-zinc-200 px-4 py-4 sm:px-6";
const TITLE_CLASS_NAME =
  "text-lg font-semibold tracking-tight text-zinc-900";
const DESCRIPTION_CLASS_NAME = "mt-1 text-sm leading-relaxed text-zinc-600";
const BODY_CLASS_NAME = "px-4 py-5 sm:px-6 sm:py-6";

/**
 * Shared presentational panel shell for Reporting Dashboard composition states.
 * Owns the single outer container and spacing scale used by Workspace-hosted UI.
 */
export const ReportingDashboardPanel = memo(function ReportingDashboardPanel({
  headingId,
  title,
  description,
  children,
}: ReportingDashboardPanelProps) {
  const descriptionId = `${headingId}-description`;

  return (
    <section
      aria-labelledby={headingId}
      aria-describedby={description ? descriptionId : undefined}
      className={PANEL_CLASS_NAME}
    >
      <div className={HEADER_CLASS_NAME}>
        <h3 id={headingId} className={TITLE_CLASS_NAME}>
          {title}
        </h3>
        {description ? (
          <p id={descriptionId} className={DESCRIPTION_CLASS_NAME}>
            {description}
          </p>
        ) : null}
      </div>

      <div className={BODY_CLASS_NAME}>{children}</div>
    </section>
  );
});
