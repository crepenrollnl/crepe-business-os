import { AuthGuard } from "@/features/auth/components/auth-guard";
import { QuickSalePage } from "@/features/sales/page/quick-sale-page";

export default function Page() {
  return (
    <AuthGuard>
      <QuickSalePage />
    </AuthGuard>
  );
}
