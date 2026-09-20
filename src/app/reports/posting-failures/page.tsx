import { AuthGuard } from "@/features/auth/components/auth-guard";
import { PostingFailuresPage } from "@/features/accounting/page/posting-failures-page";

export default function Page() {
  return (
    <AuthGuard>
      <PostingFailuresPage />
    </AuthGuard>
  );
}
