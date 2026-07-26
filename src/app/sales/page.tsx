import { AuthGuard } from "@/features/auth/components/auth-guard";
import { SalesPage } from "@/features/sales/page/sales-page";

export default function Page() {
  return (
    <AuthGuard>
      <SalesPage />
    </AuthGuard>
  );
}
