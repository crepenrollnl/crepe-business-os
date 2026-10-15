import { AuthGuard } from "@/features/auth/components/auth-guard";
import { WriteOffRequestsPage } from "@/features/write-off-requests/page/write-off-requests-page";

export default function Page() {
  return (
    <AuthGuard>
      <WriteOffRequestsPage />
    </AuthGuard>
  );
}
