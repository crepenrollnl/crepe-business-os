import { DashboardCard } from "@/features/dashboard/components/dashboard-card";
import { DashboardLayout } from "@/components/layout/dashboard-layout";

export function DashboardPage() {
  return (
    <DashboardLayout activePath="/">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8">
          <h2 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
            Dashboard
          </h2>
          <p className="mt-2 text-base text-zinc-600 sm:text-lg">
            Welcome to Crepe&apos;n Roll Business Operating System.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
          <DashboardCard title="Today's Sales">
            <p className="text-3xl font-semibold">—</p>
            <p className="mt-2 text-sm text-zinc-500">No data yet</p>
          </DashboardCard>

          <DashboardCard title="Inventory Status">
            <p className="text-3xl font-semibold">—</p>
            <p className="mt-2 text-sm text-zinc-500">All systems nominal</p>
          </DashboardCard>

          <DashboardCard title="Upcoming Events">
            <p className="text-3xl font-semibold">—</p>
            <p className="mt-2 text-sm text-zinc-500">Nothing scheduled</p>
          </DashboardCard>

          <DashboardCard title="Production">
            <p className="text-3xl font-semibold">—</p>
            <p className="mt-2 text-sm text-zinc-500">No active batches</p>
          </DashboardCard>
        </div>
      </div>
    </DashboardLayout>
  );
}
