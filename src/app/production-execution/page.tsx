import { AuthGuard } from "@/features/auth/components/auth-guard";
import { ProductionExecutionPage } from "@/features/production-execution/page/production-execution-page";

export default function Page() {
  return (
    <AuthGuard>
      <ProductionExecutionPage />
    </AuthGuard>
  );
}
