import { AuthGuard } from "@/features/auth/components/auth-guard";
import { ExpensesPage } from "@/features/expenses/page/expenses-page";

export default function Page() {
  return (
    <AuthGuard>
      <ExpensesPage />
    </AuthGuard>
  );
}
