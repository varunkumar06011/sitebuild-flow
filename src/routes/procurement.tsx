import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, StatusPill } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  REQUISITIONS,
  PROCUREMENT_STAGES,
  approverFor,
  inr,
  type Requisition,
} from "@/lib/erp-data";
import { useRole } from "@/lib/role-context";
import { requireAuth } from "@/lib/auth-guards";
import { toast } from "sonner";
import { FileText, Check } from "lucide-react";

export const Route = createFileRoute("/procurement")({
  head: () => ({
    meta: [
      { title: "Procurement Pipeline — Meditrust ERP" },
      {
        name: "description",
        content:
          "Track purchase requisitions from PR and quotations through PO, material receipt, invoice and vendor payment.",
      },
      { property: "og:title", content: "Procurement Pipeline — Meditrust ERP" },
      {
        property: "og:description",
        content: "PR → Quotation → Approval → PO → Receipt → Invoice → Payment in one linked chain.",
      },
    ],
  }),
  beforeLoad: () => requireAuth(),
  component: Procurement,
});

function Procurement() {
  const { role } = useRole();
  const [open, setOpen] = useState<Requisition | null>(null);

  return (
    <AppShell
      title="Procurement pipeline"
      subtitle="PR → Quotation → Approval → PO → Material received → Invoice → Payment"
    >
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-bold">Requisitions</h2>
          <Button
            size="sm"
            disabled={role !== "Supervisor"}
            onClick={() => toast.success("PR draft created (prototype)")}
          >
            New purchase requisition
          </Button>
        </div>
        {role !== "Supervisor" && (
          <p className="mt-2 text-xs text-muted-foreground">
            Only a Supervisor raises PRs. Switch role in the header to try it.
          </p>
        )}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-2 font-semibold">PR</th>
                <th className="pb-2 font-semibold">Item</th>
                <th className="pb-2 font-semibold">Vendor</th>
                <th className="pb-2 text-right font-semibold">Value</th>
                <th className="pb-2 font-semibold">Stage</th>
                <th className="pb-2 font-semibold">Authority</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {REQUISITIONS.map((r) => (
                <tr key={r.id} className="align-middle">
                  <td className="py-3 font-mono text-xs">{r.id}</td>
                  <td className="py-3">
                    <p className="font-medium">{r.title}</p>
                    <p className="text-xs text-muted-foreground">{r.block}</p>
                  </td>
                  <td className="py-3 text-muted-foreground">{r.vendor}</td>
                  <td className="py-3 text-right font-mono font-semibold">{inr(r.amount)}</td>
                  <td className="py-3">
                    <StatusPill
                      tone={
                        r.stage === "Completed"
                          ? "success"
                          : r.stage === "Admin" || r.stage === "A1"
                            ? "warning"
                            : "info"
                      }
                    >
                      {r.stage}
                    </StatusPill>
                  </td>
                  <td className="py-3 text-xs text-muted-foreground">{approverFor(r.amount)}</td>
                  <td className="py-3 text-right">
                    <Button variant="ghost" size="sm" onClick={() => setOpen(r)}>
                      View
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {open.id} · {open.title}
                </DialogTitle>
                <DialogDescription>
                  {open.block} · raised by {open.raisedBy} on {open.date}
                </DialogDescription>
              </DialogHeader>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Workflow
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {PROCUREMENT_STAGES.map((s, i) => {
                    const done = i <= PROCUREMENT_STAGES.indexOf(open.stage);
                    return (
                      <span
                        key={s}
                        className={`rounded-md px-2 py-1 text-xs font-medium ${
                          done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {s}
                      </span>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Quotations
                </p>
                <div className="mt-2 space-y-2">
                  {open.quotations.map((q) => (
                    <div
                      key={q.vendor}
                      className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                    >
                      <span className="flex items-center gap-2">
                        {q.selected && <Check className="size-4 text-success" />}
                        {q.vendor}
                      </span>
                      <span className="font-mono font-semibold">{inr(q.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Linked documents
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {open.documents.map((d) => (
                    <span
                      key={d}
                      className="inline-flex items-center gap-1.5 rounded-md bg-surface px-2.5 py-1.5 text-xs font-medium"
                    >
                      <FileText className="size-3.5 text-muted-foreground" />
                      {d}
                    </span>
                  ))}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
