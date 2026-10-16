"use client";

import { useState } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { useRole } from "@/hooks/use-role";
import { canSeeCosts } from "@/lib/roles";
import { WriteOffRequestForm } from "../components/write-off-request-form";
import { WriteOffRequestList } from "../components/write-off-request-list";
import { WriteOffRequestQueue } from "../components/write-off-request-queue";
import { useWriteOffRequestForm } from "../hooks/use-write-off-request-form";
import { useWriteOffRequests } from "../hooks/use-write-off-requests";

type WriteOffRequestsPageProps = {
  /** Skip DashboardLayout when composed under the Inventory tabs. */
  embedded?: boolean;
  /** Inventory "Requests" tab: only the owner/partner queue and history. */
  queueOnly?: boolean;
};

function RequestFormSection({ onSubmitted }: { onSubmitted: () => void }) {
  const form = useWriteOffRequestForm({ onSubmitted });

  return (
    <WriteOffRequestForm
      draft={form.draft}
      filteredOptions={form.filteredOptions}
      selectedItem={form.selectedItem}
      optionsLoading={form.optionsLoading}
      optionsError={form.optionsError}
      submitting={form.submitting}
      submitError={form.submitError}
      success={form.success}
      onItemTypeChange={form.setItemType}
      onFieldChange={form.updateField}
      onSubmit={form.submit}
      onRetryOptions={() => {
        void form.retryOptions();
      }}
    />
  );
}

/**
 * Write-off requests (sql/157). A seller asks and follows their own
 * requests; the owner or a partner approves (quantity editable) or rejects.
 * No cost, value or price is shown to anyone here.
 */
export function WriteOffRequestsPage({
  embedded = false,
  queueOnly = false,
}: WriteOffRequestsPageProps) {
  const { role } = useRole();
  const canDecide = canSeeCosts(role);
  const requests = useWriteOffRequests();
  const [formOpen, setFormOpen] = useState(false);

  const reloadList = () => {
    void requests.reload();
  };

  const listState = requests.loading ? (
    <p className="rounded-xl border border-zinc-200 bg-white px-4 py-8 text-center text-sm text-zinc-500 shadow-sm">
      Loading requests…
    </p>
  ) : requests.error ? (
    <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
      <p className="text-sm text-red-700">{requests.error}</p>
      <button
        type="button"
        onClick={() => {
          void requests.retry();
        }}
        className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
      >
        Try again
      </button>
    </div>
  ) : null;

  const ownerLists = (
    <>
      {requests.notice ? (
        <p role="status" className="text-sm font-medium text-emerald-700">
          {requests.notice}
        </p>
      ) : null}
      {listState ?? (
        <>
          <WriteOffRequestQueue
            items={requests.pending}
            busyId={requests.busyId}
            rowErrors={requests.rowErrors}
            onApprove={requests.approve}
            onReject={requests.reject}
          />
          <WriteOffRequestList
            title="Decided"
            items={requests.decided}
            emptyText="No decided requests yet."
            showType
            testId="write-off-request-decided"
          />
        </>
      )}
    </>
  );

  if (queueOnly) {
    return <div className="space-y-6">{canDecide ? ownerLists : null}</div>;
  }

  const content = (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
          Write-off requests
        </h1>
        <p className="mt-2 text-base text-zinc-600 sm:text-lg">
          {canDecide
            ? "Approve or reject write-offs your team asked for. Approving writes the stock off."
            : "Ask for spoiled, broken or missing items to be written off. Stock changes only after the owner approves."}
        </p>
      </div>

      {canDecide ? (
        <>
          {ownerLists}
          <section className="space-y-3">
            <button
              type="button"
              aria-expanded={formOpen}
              onClick={() => setFormOpen((open) => !open)}
              className="text-sm font-semibold text-amber-700 hover:text-amber-800"
            >
              {formOpen ? "Hide new request" : "New request"}
            </button>
            {formOpen ? <RequestFormSection onSubmitted={reloadList} /> : null}
          </section>
        </>
      ) : (
        <>
          <RequestFormSection onSubmitted={reloadList} />
          {listState ?? (
            <WriteOffRequestList
              title="My requests"
              items={requests.mine}
              emptyText="You have not asked for a write-off yet."
              testId="write-off-request-mine"
            />
          )}
        </>
      )}
    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <DashboardLayout activePath="/write-off-requests">{content}</DashboardLayout>
  );
}
