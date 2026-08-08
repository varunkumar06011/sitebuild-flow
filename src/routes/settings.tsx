// Organization settings page for viewing and editing company profile, GST and contact details.
import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchOrgSettings, updateOrgSettings } from "@/lib/api/settings";
import { useRole } from "@/lib/role-context";
import { requireAuth } from "@/lib/auth-guards";
import { toast } from "sonner";
import { Save, Building2 } from "lucide-react";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Organization Settings — Meditrust ERP" },
      {
        name: "description",
        content: "Configure organization profile: name, GST, address, contact details.",
      },
    ],
  }),
  beforeLoad: async () => {
    await requireAuth();
  },
  component: SettingsPage,
});

// Main settings page with a form for organization profile fields, editable by A1+ roles.
function SettingsPage() {
  const { role } = useRole();
  const queryClient = useQueryClient();
  const canEdit = role === "A1+" || role === "A1";

  const { data: settingsData } = useQuery({
    queryKey: ["orgSettings"],
    queryFn: () => fetchOrgSettings(),
  });

  const settings = settingsData?.success ? settingsData.data : null;

  const [form, setForm] = useState({
    name: "",
    gst_number: "",
    address: "",
    city: "",
    state: "",
    pincode: "",
    phone: "",
    email: "",
    logo_url: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) {
      setForm({
        name: settings.name ?? "",
        gst_number: settings.gst_number ?? "",
        address: settings.address ?? "",
        city: settings.city ?? "",
        state: settings.state ?? "",
        pincode: settings.pincode ?? "",
        phone: settings.phone ?? "",
        email: settings.email ?? "",
        logo_url: settings.logo_url ?? "",
      });
    }
  }, [settings]);

  // Persists the organization settings form via the API and refreshes the query cache.
  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("Organization name is required");
      return;
    }
    setSaving(true);
    try {
      const result = await updateOrgSettings({
        data: {
          name: form.name.trim(),
          gst_number: form.gst_number.trim() || undefined,
          address: form.address.trim() || undefined,
          city: form.city.trim() || undefined,
          state: form.state.trim() || undefined,
          pincode: form.pincode.trim() || undefined,
          phone: form.phone.trim() || undefined,
          email: form.email.trim() || undefined,
          logo_url: form.logo_url.trim() || undefined,
        },
      });
      if (result.success) {
        toast.success("Settings saved");
        queryClient.invalidateQueries({ queryKey: ["orgSettings"] });
      } else {
        toast.error(result.error ?? "Failed to save settings");
      }
    } catch {
      toast.error("Failed to save settings");
    }
    setSaving(false);
  };

  return (
    <AppShell
      title="Organization settings"
      subtitle="Company profile, GST, and contact information"
    >
      <Card className="max-w-2xl p-6">
        <div className="flex items-center gap-3 border-b border-border pb-4">
          <Building2 className="size-6 text-primary" />
          <div>
            <h2 className="text-sm font-bold">Organization profile</h2>
            <p className="text-xs text-muted-foreground">
              {canEdit ? "Edit your organization details" : "View organization details (read-only)"}
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="oname">Organization name *</Label>
            <Input
              id="oname"
              value={form.name}
              disabled={!canEdit}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ogst">GST number</Label>
              <Input
                id="ogst"
                value={form.gst_number}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, gst_number: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ophone">Phone</Label>
              <Input
                id="ophone"
                value={form.phone}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="oaddr">Address</Label>
            <Input
              id="oaddr"
              value={form.address}
              disabled={!canEdit}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ocity">City</Label>
              <Input
                id="ocity"
                value={form.city}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ostate">State</Label>
              <Input
                id="ostate"
                value={form.state}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="opin">Pincode</Label>
              <Input
                id="opin"
                value={form.pincode}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, pincode: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="oemail">Email</Label>
            <Input
              id="oemail"
              type="email"
              value={form.email}
              disabled={!canEdit}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>

          {canEdit && (
            <div className="mt-2 flex justify-end">
              <Button disabled={saving} onClick={handleSave}>
                <Save className="mr-2 size-4" />
                {saving ? "Saving..." : "Save settings"}
              </Button>
            </div>
          )}
        </div>
      </Card>
    </AppShell>
  );
}
