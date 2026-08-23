import { AuthGuard } from "@/features/auth/components/auth-guard";
import { FinishedGoodsPage } from "@/features/finished-goods/page/finished-goods-page";

export default function Page() {
  return (
    <AuthGuard>
      <FinishedGoodsPage />
    </AuthGuard>
  );
}
