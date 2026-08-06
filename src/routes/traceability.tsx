import { createFileRoute } from "@tanstack/react-router";
import { AppShell, StatusPill } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { BATCHES } from "@/lib/erp-data";
import { Camera } from "lucide-react";

export const Route = createFileRoute("/traceability")({
  head: () => ({
    meta: [
      { title: "Material Traceability — Meditrust ERP" },
      {
        name: "description",
        content:
          "Trace every batch: supplier, manufacturer, purchase date, invoice, delivery challan, MTC, lab report and photos.",
      },
      { property: "og:title", content: "Material Traceability — Meditrust ERP" },
      {
        property: "og:description",
        content: "Supplier → Batch → Manufacturer → Invoice → Challan → MTC → Lab report → Photos.",
      },
    ],
  }),
  component: Traceability,
});

const CHAIN = [
  "Supplier",
  "Batch",
  "Manufacturer",
  "Purchase date",
  "Invoice",
  "Delivery challan",
  "MTC",
  "Lab report",
  "Photos",
];

function Traceability() {
  return (
    <AppShell
      title="Material traceability"
      subtitle="Every batch carries its full document chain from supplier to installed location"
    >
      <Card className="p-5">
        <div className="flex flex-wrap gap-1.5">
          {CHAIN.map((c) => (
            <span key={c} className="rounded-md bg-surface px-2.5 py-1 text-xs font-medium">
              {c}
            </span>
          ))}
        </div>
      </Card>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {BATCHES.map((b) => (
          <Card key={b.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{b.material}</p>
                <p className="font-mono text-xs text-muted-foreground">{b.id}</p>
              </div>
              <StatusPill
                tone={b.status === "Verified" ? "success" : b.status === "Pending MTC" ? "danger" : "warning"}
              >
                {b.status}
              </StatusPill>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <Field k="Supplier" v={b.supplier} />
              <Field k="Manufacturer" v={b.manufacturer} />
              <Field k="Purchase date" v={b.purchaseDate} />
              <Field k="Invoice" v={b.invoice} />
              <Field k="Delivery challan" v={b.challan} />
              <Field k="MTC" v={b.mtc} />
              <Field k="Lab report" v={b.labReport} />
            </dl>
            <p className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Camera className="size-3.5" /> {b.photos} site photos attached
            </p>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}
