import { AuthGuard } from "@/features/auth/components/auth-guard";
import { DashboardPage } from "@/features/dashboard/page/dashboard-page";

export default function Home() {
  return (
    <AuthGuard>
      <DashboardPage />
    </AuthGuard>
  );
}