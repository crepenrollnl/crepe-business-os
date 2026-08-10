import { AuthGuard } from "@/features/auth/components/auth-guard";
import { ProductionPage } from "@/features/production/page/production-page";

export default function Page() {
  return (
    <AuthGuard>
      <ProductionPage />
    </AuthGuard>
  );
}
