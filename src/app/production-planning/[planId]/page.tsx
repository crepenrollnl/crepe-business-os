import { AuthGuard } from "@/features/auth/components/auth-guard";
import { ProductionPlanDetailPage } from "@/features/production/page/production-plan-detail-page";

type PageProps = {
  params: Promise<{
    planId: string;
  }>;
};

export default async function Page({ params }: PageProps) {
  const { planId } = await params;

  return (
    <AuthGuard>
      <ProductionPlanDetailPage planId={planId} />
    </AuthGuard>
  );
}
