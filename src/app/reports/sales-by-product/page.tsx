import { AuthGuard } from "@/features/auth/components/auth-guard";
import { SalesProductReportPage } from "@/features/sales-product-report/page/sales-product-report-page";

export default function Page() {
  return (
    <AuthGuard>
      <SalesProductReportPage />
    </AuthGuard>
  );
}
