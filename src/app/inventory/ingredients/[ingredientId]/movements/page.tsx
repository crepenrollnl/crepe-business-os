import { AuthGuard } from "@/features/auth/components/auth-guard";
import { IngredientMovementHistoryPage } from "@/features/inventory-movement-history/page/ingredient-movement-history-page";

type PageProps = {
  params: Promise<{
    ingredientId: string;
  }>;
};

export default async function Page({ params }: PageProps) {
  const { ingredientId } = await params;

  return (
    <AuthGuard>
      <IngredientMovementHistoryPage ingredientId={ingredientId} />
    </AuthGuard>
  );
}
