import { AuthGuard } from "@/features/auth/components/auth-guard";
import { RecipesPage } from "@/features/recipes/page/recipes-page";

export default function Page() {
  return (
    <AuthGuard>
      <RecipesPage />
    </AuthGuard>
  );
}
