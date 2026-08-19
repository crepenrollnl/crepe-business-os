import { Suspense } from "react";
import { AuthGuard } from "@/features/auth/components/auth-guard";
import { AuthLoading } from "@/features/auth/components/auth-loading";
import { PosPage } from "@/features/pos/page/pos-page";

export default function Page() {
  return (
    <AuthGuard>
      <Suspense fallback={<AuthLoading />}>
        <PosPage />
      </Suspense>
    </AuthGuard>
  );
}
