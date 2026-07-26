import { AuthGuard } from "@/features/auth/components/auth-guard";
import { ProductionExecutionPlanDetailPage } from "@/features/production-execution/page/production-execution-plan-detail-page";

type PageProps = {
  params: Promise<{
    planId: string;
  }>;
};

export default async function Page({ params }: PageProps) {
  const { planId } = await params;

  return (
    <AuthGuard>
      <ProductionExecutionPlanDetailPage planId={planId} />
    </AuthGuard>
  );
}
