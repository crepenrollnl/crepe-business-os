import { AuthGuard } from "@/features/auth/components/auth-guard";
import { PurchasesPage } from "@/features/purchases/page/purchases-page";

export default function Page() {
  return (
    <AuthGuard>
      <PurchasesPage />
    </AuthGuard>
  );
}
