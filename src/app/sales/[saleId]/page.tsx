import { AuthGuard } from "@/features/auth/components/auth-guard";
import { SaleDetailPage } from "@/features/sales/page/sale-detail-page";

type PageProps = {
  params: Promise<{
    saleId: string;
  }>;
};

export default async function Page({ params }: PageProps) {
  const { saleId } = await params;

  return (
    <AuthGuard>
      <SaleDetailPage saleId={saleId} />
    </AuthGuard>
  );
}
