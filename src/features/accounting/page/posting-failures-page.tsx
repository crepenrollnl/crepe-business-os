"use client";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { PostingFailuresList } from "../components/posting-failures-list";
import { usePostingFailures } from "../hooks/use-posting-failures";

export function PostingFailuresPage() {
  const {
    items,
    loading,
    error,
    resolvingId,
    actionError,
    resolve,
    retry,
  } = usePostingFailures();

  return (
    <DashboardLayout activePath="/reports/posting-failures">
      <div className="mx-auto max-w-7xl space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
            Posting failures
          </h1>
          <p className="mt-2 text-base text-zinc-600 sm:text-lg">
            Accounting journals that failed after the physical operation
            already committed. Owner and partner only.
          </p>
        </div>

        <PostingFailuresList
          items={items}
          loading={loading}
          error={error}
          resolvingId={resolvingId}
          actionError={actionError}
          onRetry={() => {
            void retry();
          }}
          onResolve={resolve}
        />
      </div>
    </DashboardLayout>
  );
}
