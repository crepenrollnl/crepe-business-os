import { AuthGuard } from "@/features/auth/components/auth-guard";
import { ProductionSessionPage } from "@/features/production-execution/page/production-session-page";

type PageProps = {
  params: Promise<{
    sessionId: string;
  }>;
};

export default async function Page({ params }: PageProps) {
  const { sessionId } = await params;

  return (
    <AuthGuard>
      <ProductionSessionPage sessionId={sessionId} />
    </AuthGuard>
  );
}
