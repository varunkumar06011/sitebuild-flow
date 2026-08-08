// Decision history panel showing past approvals and rejections from requisition data.
// Renders approved_by/approved_at and rejected_by/rejected_at with rejection reason.
import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/AppShell";
import { inr } from "@/lib/erp-data";
import type { RequisitionRow } from "@/lib/api/requisitions";
import { CheckCircle2, XCircle, ChevronDown, ChevronUp } from "lucide-react";

export type DecisionHistoryProps = {
  requisitions: RequisitionRow[];
  // Limit the number of rows shown initially (rest revealed on "Show more").
  initialLimit?: number;
};

// Formats an ISO timestamp as a readable date-time string.
function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// DecisionHistory — collapsible list of past approval/rejection decisions.
export function DecisionHistory({ requisitions, initialLimit = 5 }: DecisionHistoryProps) {
  const [expanded, setExpanded] = useState(false);

  // Filter to requisitions that have an approval or rejection recorded, newest first.
  const history = useMemo(
    () =>
      requisitions
        .filter((r) => r.approved_at || r.rejected_at)
        .sort((a, b) => {
          const aTime = a.approved_at ?? a.rejected_at ?? "";
          const bTime = b.approved_at ?? b.rejected_at ?? "";
          return bTime.localeCompare(aTime);
        }),
    [requisitions],
  );

  if (history.length === 0) {
    return null;
  }

  const visible = expanded ? history : history.slice(0, initialLimit);
  const hiddenCount = history.length - initialLimit;

  return (
    <Card className="mt-6 p-5">
      <h2 className="text-sm font-bold">Decision history</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Past approvals and rejections across all requisitions.
      </p>
      <div className="mt-4">
        {/* Desktop table */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[700px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-2 font-semibold">PR</th>
                <th className="pb-2 font-semibold">Item</th>
                <th className="pb-2 text-right font-semibold">Value</th>
                <th className="pb-2 font-semibold">Decision</th>
                <th className="pb-2 font-semibold">When</th>
                <th className="pb-2 font-semibold">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map((r) => {
                const approved = !!r.approved_at;
                return (
                  <tr key={r.id} className="align-middle">
                    <td className="py-3 font-mono text-xs">{r.pr_number}</td>
                    <td className="py-3 font-medium">{r.title}</td>
                    <td className="py-3 text-right font-mono">{inr(r.amount)}</td>
                    <td className="py-3">
                      <span className="inline-flex items-center gap-1.5">
                        {approved ? (
                          <CheckCircle2 className="size-4 text-success" />
                        ) : (
                          <XCircle className="size-4 text-destructive" />
                        )}
                        <StatusPill tone={approved ? "success" : "danger"}>
                          {approved ? "Approved" : "Rejected"}
                        </StatusPill>
                      </span>
                    </td>
                    <td className="py-3 text-xs text-muted-foreground">
                      {formatDateTime(r.approved_at ?? r.rejected_at)}
                    </td>
                    <td className="py-3 text-xs text-muted-foreground">
                      {r.rejection_reason ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="space-y-3 md:hidden">
          {visible.map((r) => {
            const approved = !!r.approved_at;
            return (
              <div key={r.id} className="rounded-xl border border-border p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{r.pr_number}</span>
                  <span className="inline-flex items-center gap-1.5">
                    {approved ? (
                      <CheckCircle2 className="size-4 text-success" />
                    ) : (
                      <XCircle className="size-4 text-destructive" />
                    )}
                    <StatusPill tone={approved ? "success" : "danger"}>
                      {approved ? "Approved" : "Rejected"}
                    </StatusPill>
                  </span>
                </div>
                <p className="mb-1 font-medium leading-snug">{r.title}</p>
                <p className="font-mono text-sm font-semibold">{inr(r.amount)}</p>
                <div className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
                  <p>{formatDateTime(r.approved_at ?? r.rejected_at)}</p>
                  {r.rejection_reason && <p className="mt-1">Reason: {r.rejection_reason}</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {hiddenCount > 0 && (
        <div className="mt-4 text-center">
          <Button variant="outline" size="sm" onClick={() => setExpanded((e) => !e)}>
            {expanded ? (
              <>
                <ChevronUp className="size-4" /> Show less
              </>
            ) : (
              <>
                <ChevronDown className="size-4" /> Show {hiddenCount} more
              </>
            )}
          </Button>
        </div>
      )}
    </Card>
  );
}
