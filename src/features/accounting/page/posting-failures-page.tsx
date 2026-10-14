"use client";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { PostingFailuresList } from "../components/posting-failures-list";
import { usePostingFailures } from "../hooks/use-posting-failures";

export function PostingFailuresPage() {
  const {
    items,
    loading,
    error,
    access,
    resolvingId,
    repostingId,
    actionError,
    rowErrors,
    notice,
    resolve,
    repost,
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

        {access === "denied" ? (
          <div
            className="rounded-xl border border-zinc-200 bg-white px-4 py-16 text-center shadow-sm"
            data-testid="posting-failures-denied"
          >
            <p className="text-base font-medium text-zinc-900">
              Only the owner or a partner can see posting failures.
            </p>
          </div>
        ) : (
          <PostingFailuresList
            items={items}
            loading={loading}
            error={error}
            resolvingId={resolvingId}
            repostingId={repostingId}
            actionError={actionError}
            rowErrors={rowErrors}
            notice={notice}
            onRetry={() => {
              void retry();
            }}
            onResolve={resolve}
            onRepost={repost}
          />
        )}
      </div>
    </DashboardLayout>
  );
}
