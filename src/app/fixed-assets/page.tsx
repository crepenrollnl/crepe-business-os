import { AuthGuard } from "@/features/auth/components/auth-guard";
import { FixedAssetsPage } from "@/features/fixed-assets/page/fixed-assets-page";

export default function Page() {
  return (
    <AuthGuard>
      <FixedAssetsPage />
    </AuthGuard>
  );
}
