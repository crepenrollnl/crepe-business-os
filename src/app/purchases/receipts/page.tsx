import { AuthGuard } from "@/features/auth/components/auth-guard";
import { PurchaseReceiptsPage } from "@/features/purchases/page/purchase-receipts-page";

export default function Page() {
  return (
    <AuthGuard>
      <PurchaseReceiptsPage />
    </AuthGuard>
  );
}
