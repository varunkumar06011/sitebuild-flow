// Notification Settings — user preferences for SMS/WhatsApp/Email/in-app per event type.
// Admins can also view the notification queue and trigger processing.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell, StatusPill } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  fetchNotificationPreferences,
  updateNotificationPreference,
  fetchNotificationQueue,
  processPendingNotifications,
  fetchProviderStatus,
  NOTIFICATION_EVENTS,
} from "@/lib/api/notification-system";
import { useRole } from "@/lib/role-context";
import { requireAuth } from "@/lib/auth-guards";
import { toast } from "sonner";
import {
  Bell,
  MessageSquare,
  Mail,
  Smartphone,
  Loader2,
  Send,
  Zap,
  CheckCircle2,
  XCircle,
} from "lucide-react";

export const Route = createFileRoute("/notification-settings")({
  head: () => ({
    meta: [
      { title: "Notification Settings — Meditrust ERP" },
      {
        name: "description",
        content: "Configure SMS, WhatsApp, email, and in-app notification preferences.",
      },
    ],
  }),
  beforeLoad: () => {
    requireAuth();
  },
  component: NotificationSettingsPage,
});

const EVENT_LABELS: Record<string, string> = {
  approval_pending: "Approval Pending",
  approval_approved: "Approval Approved",
  approval_rejected: "Approval Rejected",
  gate_pass_otp: "Gate Pass OTP",
  gate_pass_created: "Gate Pass Created",
  low_stock: "Low Stock Alert",
  payment_recorded: "Payment Recorded",
  pr_created: "PR Created",
  po_issued: "PO Issued",
  material_received: "Material Received",
  qc_failed: "QC Failed",
  escalation_triggered: "Escalation Triggered",
};

function NotificationSettingsPage() {
  const { role } = useRole();
  const queryClient = useQueryClient();
  const [processing, setProcessing] = useState(false);
  const isAdmin = role === "Administrator" || role === "A1+";

  const { data: prefsData, isLoading } = useQuery({
    queryKey: ["notification-prefs"],
    queryFn: () => fetchNotificationPreferences(),
  });
  const prefs = prefsData?.data ?? [];

  const { data: queueData } = useQuery({
    queryKey: ["notification-queue"],
    queryFn: () => fetchNotificationQueue(),
    enabled: isAdmin,
  });
  const queue = queueData?.data ?? [];

  const { data: providerStatusData } = useQuery({
    queryKey: ["notification-provider-status"],
    queryFn: () => fetchProviderStatus(),
    enabled: isAdmin,
  });
  const providerStatus = providerStatusData?.data;

  const handleToggle = async (eventType: string, channel: string, value: boolean) => {
    try {
      const result = await updateNotificationPreference({
        event_type: eventType,
        [channel]: value,
      });
      if (result.success) {
        queryClient.invalidateQueries({ queryKey: ["notification-prefs"] });
      } else {
        toast.error("Failed to update preference");
      }
    } catch {
      toast.error("Failed to update preference");
    }
  };

  const handleProcess = async () => {
    setProcessing(true);
    try {
      const result = await processPendingNotifications();
      if (result.success) {
        toast.success(`Processed: ${result.sent} sent, ${result.failed} failed`);
        queryClient.invalidateQueries({ queryKey: ["notification-queue"] });
      } else {
        toast.error(result.error ?? "Processing failed");
      }
    } catch {
      toast.error("Processing failed");
    }
    setProcessing(false);
  };

  return (
    <AppShell
      title="Notification Settings"
      subtitle="Configure SMS, WhatsApp, email, and in-app alerts"
    >
      <Tabs defaultValue="preferences">
        <TabsList className="flex h-auto flex-wrap gap-1">
          <TabsTrigger value="preferences" className="gap-1.5">
            <Bell className="size-3.5" /> My Preferences
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="queue" className="gap-1.5">
              <Send className="size-3.5" /> Delivery Queue
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="preferences">
          {isAdmin && providerStatus && (
            <Card className="mb-4 p-4">
              <p className="text-sm font-bold">Channel Connection Status</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Shows whether external notification providers are configured. Unconfigured channels
                will fail to deliver.
              </p>
              <div className="mt-3 flex flex-wrap gap-4">
                {(
                  [
                    { key: "sms", label: "SMS", icon: Smartphone, status: providerStatus.sms },
                    {
                      key: "whatsapp",
                      label: "WhatsApp",
                      icon: MessageSquare,
                      status: providerStatus.whatsapp,
                    },
                    { key: "email", label: "Email", icon: Mail, status: providerStatus.email },
                  ] as const
                ).map(({ key, label, icon: Icon, status }) => (
                  <div
                    key={key}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                      status?.configured
                        ? "border-success/30 bg-success/5"
                        : "border-destructive/30 bg-destructive/5"
                    }`}
                  >
                    <Icon className="size-4 shrink-0" />
                    <div>
                      <span className="font-medium">{label}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{status?.provider}</span>
                    </div>
                    {status?.configured ? (
                      <CheckCircle2 className="ml-1 size-4 text-success" />
                    ) : (
                      <XCircle className="ml-1 size-4 text-destructive" />
                    )}
                  </div>
                ))}
              </div>
              {!providerStatus.sms?.configured &&
                !providerStatus.whatsapp?.configured &&
                !providerStatus.email?.configured && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    No external providers are configured. Only in-app notifications will be
                    delivered. Set the required env vars (TWILIO_*, GUPSHUP_*, AWS_SES_*) to enable
                    SMS, WhatsApp, and email delivery.
                  </p>
                )}
            </Card>
          )}
          <Card className="p-5">
            <p className="text-sm font-bold">Notification Preferences</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Choose how you want to be notified for each event. SMS, WhatsApp, and Email require
              provider configuration by your administrator.
            </p>
            {isLoading ? (
              <div className="py-8 text-center">
                <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="pb-2 font-semibold">Event</th>
                      <th className="pb-2 text-center font-semibold">
                        <span className="flex items-center justify-center gap-1">
                          <Smartphone className="size-3.5" /> SMS
                        </span>
                      </th>
                      <th className="pb-2 text-center font-semibold">
                        <span className="flex items-center justify-center gap-1">
                          <MessageSquare className="size-3.5" /> WhatsApp
                        </span>
                      </th>
                      <th className="pb-2 text-center font-semibold">
                        <span className="flex items-center justify-center gap-1">
                          <Mail className="size-3.5" /> Email
                        </span>
                      </th>
                      <th className="pb-2 text-center font-semibold">
                        <span className="flex items-center justify-center gap-1">
                          <Bell className="size-3.5" /> In-App
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {prefs.map((p: any) => (
                      <tr key={p.event_type} className="align-middle">
                        <td className="py-3 font-medium">
                          {EVENT_LABELS[p.event_type] ?? p.event_type}
                        </td>
                        <td className="py-3 text-center">
                          <Switch
                            checked={p.sms}
                            onCheckedChange={(v) => handleToggle(p.event_type, "sms", v)}
                          />
                        </td>
                        <td className="py-3 text-center">
                          <Switch
                            checked={p.whatsapp}
                            onCheckedChange={(v) => handleToggle(p.event_type, "whatsapp", v)}
                          />
                        </td>
                        <td className="py-3 text-center">
                          <Switch
                            checked={p.email}
                            onCheckedChange={(v) => handleToggle(p.event_type, "email", v)}
                          />
                        </td>
                        <td className="py-3 text-center">
                          <Switch
                            checked={p.in_app}
                            onCheckedChange={(v) => handleToggle(p.event_type, "in_app", v)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </TabsContent>

        {isAdmin && (
          <TabsContent value="queue">
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold">Notification Delivery Queue</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Pending and recently sent notifications. Processing requires provider API keys.
                  </p>
                </div>
                <Button size="sm" onClick={handleProcess} disabled={processing}>
                  {processing ? (
                    <Loader2 className="mr-1.5 size-4 animate-spin" />
                  ) : (
                    <Zap className="mr-1.5 size-4" />
                  )}
                  Process Pending
                </Button>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="pb-2 font-semibold">Date</th>
                      <th className="pb-2 font-semibold">Channel</th>
                      <th className="pb-2 font-semibold">Recipient</th>
                      <th className="pb-2 font-semibold">Subject</th>
                      <th className="pb-2 font-semibold">Status</th>
                      <th className="pb-2 font-semibold">User</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {queue.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-muted-foreground">
                          No notifications in queue.
                        </td>
                      </tr>
                    )}
                    {queue.map((n: any) => (
                      <tr key={n.id} className="align-middle">
                        <td className="py-3 text-xs text-muted-foreground">
                          {new Date(n.created_at).toLocaleString("en-IN")}
                        </td>
                        <td className="py-3">
                          <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium uppercase">
                            {n.channel}
                          </span>
                        </td>
                        <td className="py-3 font-mono text-xs">{n.recipient}</td>
                        <td className="py-3 text-xs">
                          {n.subject ?? n.body?.slice(0, 50) + "..."}
                        </td>
                        <td className="py-3">
                          <StatusPill
                            tone={
                              n.status === "sent" || n.status === "delivered"
                                ? "success"
                                : n.status === "failed"
                                  ? "danger"
                                  : "warning"
                            }
                          >
                            {n.status}
                          </StatusPill>
                        </td>
                        <td className="py-3 text-xs">{n.user_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </AppShell>
  );
}
