import { AuthGuard } from "@/features/auth/components/auth-guard";
import { ReportingWorkspacePage } from "@/features/reporting-workspace/page/reporting-workspace-page";

export default function Page() {
  return (
    <AuthGuard>
      <ReportingWorkspacePage />
    </AuthGuard>
  );
}
