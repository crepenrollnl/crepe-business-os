type DashboardCardProps = {
  title: string;
  children: React.ReactNode;
  /** Optional informational subtitle under the value. */
  detail?: string | null;
  /** Soft emphasis for attention cards — same card chrome. */
  tone?: "default" | "attention" | "muted";
};

export function DashboardCard({
  title,
  children,
  detail = null,
  tone = "default",
}: DashboardCardProps) {
  const toneClass =
    tone === "attention"
      ? "border-red-200 bg-red-50/40"
      : tone === "muted"
        ? "border-zinc-200 bg-zinc-50/60"
        : "border-zinc-200 bg-white";

  return (
    <article
      className={`rounded-xl border p-6 shadow-sm transition-shadow hover:shadow-md ${toneClass}`}
    >
      <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
        {title}
      </h3>
      <div className="mt-4 text-zinc-900">{children}</div>
      {detail ? (
        <p className="mt-2 text-sm text-zinc-500">{detail}</p>
      ) : null}
    </article>
  );
}
