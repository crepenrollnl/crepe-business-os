import { AuthGuard } from "@/features/auth/components/auth-guard";
import { InventoryPage } from "@/features/inventory/page/inventory-page";

export default function Page() {
  return (
    <AuthGuard>
      <InventoryPage />
    </AuthGuard>
  );
}
