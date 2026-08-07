import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell, StatusPill } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchVisitors, fetchVehicles, fetchLabour } from "@/lib/api/registers";
import { requireAuth } from "@/lib/auth-guards";

export const Route = createFileRoute("/registers")({
  head: () => ({
    meta: [
      { title: "Visitor, Vehicle & Labour Registers — Meditrust ERP" },
      {
        name: "description",
        content:
          "Daily site registers: visitor in/out log, vehicle movement with material carried, and contractor labour headcount.",
      },
      { property: "og:title", content: "Visitor, Vehicle & Labour Registers" },
      {
        property: "og:description",
        content: "Gate-level visitor and vehicle logs plus trade-wise labour attendance for the day.",
      },
    ],
  }),
  beforeLoad: async () => { await requireAuth(); },
  component: Registers,
});

function Registers() {
  const { data: visData } = useQuery({ queryKey: ["visitors"], queryFn: () => fetchVisitors({ data: {} }) });
  const { data: vehData } = useQuery({ queryKey: ["vehicles"], queryFn: () => fetchVehicles({ data: {} }) });
  const { data: labData } = useQuery({ queryKey: ["labour"], queryFn: () => fetchLabour({ data: {} }) });
  const visitors = visData?.data ?? [];
  const vehicles = vehData?.data ?? [];
  const labour = labData?.data ?? [];

  return (
    <AppShell title="Registers & labour" subtitle="Thursday, 06 August 2026 · Main gate">
      <Tabs defaultValue="visitors">
        <TabsList>
          <TabsTrigger value="visitors">Visitors</TabsTrigger>
          <TabsTrigger value="vehicles">Vehicles</TabsTrigger>
          <TabsTrigger value="labour">Labour</TabsTrigger>
        </TabsList>

        <TabsContent value="visitors">
          <Card className="overflow-x-auto p-5">
            <table className="w-full min-w-[720px] text-sm">
              <Head cols={["Pass", "Visitor", "Organisation", "Purpose", "In", "Out", "Host"]} />
              <tbody className="divide-y divide-border">
                {visitors.map((v: any) => (
                  <tr key={v.id}>
                    <td className="py-3 font-mono text-xs">{v.id}</td>
                    <td className="py-3 font-medium">{v.name}</td>
                    <td className="py-3 text-muted-foreground">{v.org}</td>
                    <td className="py-3 text-muted-foreground">{v.purpose}</td>
                    <td className="py-3 font-mono text-xs">{v.in_time ? new Date(v.in_time).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                    <td className="py-3">
                      {v.out_time ? (
                        <span className="font-mono text-xs">{new Date(v.out_time).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
                      ) : (
                        <StatusPill tone="info">On site</StatusPill>
                      )}
                    </td>
                    <td className="py-3 text-muted-foreground">{v.host}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </TabsContent>

        <TabsContent value="vehicles">
          <Card className="overflow-x-auto p-5">
            <table className="w-full min-w-[720px] text-sm">
              <Head cols={["Entry", "Vehicle", "Type", "Driver", "Material", "In", "Out"]} />
              <tbody className="divide-y divide-border">
                {vehicles.map((v: any) => (
                  <tr key={v.id}>
                    <td className="py-3 font-mono text-xs">{v.id}</td>
                    <td className="py-3 font-mono font-medium">{v.number}</td>
                    <td className="py-3 text-muted-foreground">{v.type}</td>
                    <td className="py-3 text-muted-foreground">{v.driver}</td>
                    <td className="py-3">{v.material}</td>
                    <td className="py-3 font-mono text-xs">{v.in_time ? new Date(v.in_time).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                    <td className="py-3">
                      {v.out_time ? (
                        <span className="font-mono text-xs">{new Date(v.out_time).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
                      ) : (
                        <StatusPill tone="warning">Inside</StatusPill>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </TabsContent>

        <TabsContent value="labour">
          <div className="grid gap-4 md:grid-cols-2">
            {labour.map((l: any) => (
              <Card key={l.trade} className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold">{l.trade}</p>
                    <p className="text-xs text-muted-foreground">
                      {l.contractor} · {l.block}
                    </p>
                  </div>
                  <span className="font-mono text-sm font-semibold">
                    {l.present}/{l.planned}
                  </span>
                </div>
                <Progress value={l.planned > 0 ? (l.present / l.planned) * 100 : 0} className="mt-3 h-2" />
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

function Head({ cols }: { cols: string[] }) {
  return (
    <thead>
      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
        {cols.map((c) => (
          <th key={c} className="pb-2 font-semibold">
            {c}
          </th>
        ))}
      </tr>
    </thead>
  );
}
