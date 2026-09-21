import { AuthGuard } from "@/features/auth/components/auth-guard";
import { ProfitAndLossPage } from "@/features/accounting/page/profit-and-loss-page";

export default function Page() {
  return (
    <AuthGuard>
      <ProfitAndLossPage />
    </AuthGuard>
  );
}
