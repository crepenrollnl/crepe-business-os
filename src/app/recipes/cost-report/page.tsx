import { AuthGuard } from "@/features/auth/components/auth-guard";
import { RecipeCostReportPage } from "@/features/recipe-cost-report/page/recipe-cost-report-page";

export default function Page() {
  return (
    <AuthGuard>
      <RecipeCostReportPage />
    </AuthGuard>
  );
}
