import { AuthGuard } from "@/features/auth/components/auth-guard";
import { BtwReportPage } from "@/features/btw-report/page/btw-report-page";

export default function Page() {
  return (
    <AuthGuard>
      <BtwReportPage />
    </AuthGuard>
  );
}
