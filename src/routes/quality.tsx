import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell, StatusPill } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { fetchInspections } from "@/lib/api/inspections";
import { requireAuth } from "@/lib/auth-guards";
import { Camera, Check, X } from "lucide-react";

export const Route = createFileRoute("/quality")({
  head: () => ({
    meta: [
      { title: "Quality Control & Inspections — Meditrust ERP" },
      {
        name: "description",
        content:
          "Inspection checklists, pass/fail results, rectification notes, re-inspection tracking and photo evidence.",
      },
      { property: "og:title", content: "Quality Control & Inspections — Meditrust ERP" },
      {
        property: "og:description",
        content: "Inspection → Checklist → Test result → Pass/Fail → Rectification → Re-inspection → Photos.",
      },
    ],
  }),
  beforeLoad: async () => { await requireAuth(); },
  component: Quality,
});

function Quality() {
  const { data: inspData } = useQuery({ queryKey: ["inspections"], queryFn: () => fetchInspections({ data: {} }) });
  const inspections = inspData?.data ?? [];

  return (
    <AppShell
      title="Quality control"
      subtitle="Inspection → Checklist → Test result → Pass/Fail → Rectification → Re-inspection"
    >
      <div className="grid gap-4 lg:grid-cols-3">
        {inspections.map((i: any) => (
          <Card key={i.id} className="flex flex-col p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{i.activity}</p>
                <p className="text-xs text-muted-foreground">
                  {i.qc_number} · {i.location}
                </p>
              </div>
              <StatusPill
                tone={i.result === "Pass" ? "success" : i.result === "Fail" ? "danger" : "warning"}
              >
                {i.result}
              </StatusPill>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {i.inspector ?? "—"} · {i.date ?? "—"}
            </p>

            <ul className="mt-4 space-y-2 text-sm">
              {Array.isArray(i.checklist) && i.checklist.map((c: any) => (
                <li key={c.item} className="flex items-start gap-2">
                  {c.ok ? (
                    <Check className="mt-0.5 size-4 shrink-0 text-success" />
                  ) : (
                    <X className="mt-0.5 size-4 shrink-0 text-destructive" />
                  )}
                  <span className={c.ok ? "" : "text-destructive"}>{c.item}</span>
                </li>
              ))}
            </ul>

            {i.rectification && (
              <div className="mt-4 rounded-lg bg-warning-soft p-3 text-xs text-warning-foreground">
                <p className="font-semibold">Rectification</p>
                <p className="mt-1">{i.rectification}</p>
              </div>
            )}

            <p className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Camera className="size-3.5" /> {Array.isArray(i.photos) ? i.photos.length : 0} photos
            </p>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
