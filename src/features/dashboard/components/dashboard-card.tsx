type DashboardCardProps = {
  title: string;
  children: React.ReactNode;
};

export function DashboardCard({ title, children }: DashboardCardProps) {
  return (
    <article className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
      <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
        {title}
      </h3>
      <div className="mt-4 text-zinc-900">{children}</div>
    </article>
  );
}
