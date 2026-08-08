// Role Change Audit — dedicated view for role-related audit trail entries.
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell, StatusPill } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { fetchRoleChangeAudit } from "@/lib/api/users";
import { requireAuth } from "@/lib/auth-guards";
import { Loader2, UserCog, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/role-audit")({
  head: () => ({
    meta: [
      { title: "Role Change Audit — Meditrust ERP" },
      {
        name: "description",
        content: "Audit trail of all role changes, user creation, and user deletions.",
      },
    ],
  }),
  beforeLoad: async () => {
    await requireAuth();
  },
  component: RoleAuditPage,
});

const ACTION_TONE: Record<string, "info" | "warning" | "danger" | "success"> = {
  create_user: "success",
  update_user: "info",
  role_change: "warning",
  delete_user: "danger",
  unlock_user: "info",
};

const ACTION_LABEL: Record<string, string> = {
  create_user: "User Created",
  update_user: "User Updated",
  role_change: "Role Changed",
  delete_user: "User Deleted",
  unlock_user: "User Unlocked",
};

function RoleAuditPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["role-change-audit"],
    queryFn: () => fetchRoleChangeAudit({ data: {} }),
  });
  const entries = data?.data ?? [];

  return (
    <AppShell
      title="Role Change Audit"
      subtitle="Complete trail of user role changes, creations, and deletions"
    >
      <Card className="overflow-hidden p-0">
        <div className="border-b border-border p-4">
          <div className="flex items-center gap-2">
            <UserCog className="size-4 text-muted-foreground" />
            <p className="font-semibold">Role Change History</p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Every user creation, role change, deletion, and unlock is recorded here.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Current Role</th>
                <th className="px-4 py-3 font-medium">Details</th>
                <th className="px-4 py-3 font-medium">Actor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center">
                    <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
                  </td>
                </tr>
              )}
              {!isLoading && entries.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    No role changes recorded.
                  </td>
                </tr>
              )}
              {entries.map((e: any) => {
                const details = e.details as any;
                const oldRole = details?.old_role;
                const newRole = details?.new_role ?? details?.role;
                return (
                  <tr key={e.id} className="hover:bg-surface/50">
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(e.created_at).toLocaleString("en-IN", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill tone={ACTION_TONE[e.action] ?? "info"}>
                        {ACTION_LABEL[e.action] ?? e.action}
                      </StatusPill>
                    </td>
                    <td className="px-4 py-3 font-medium">{e.user_name}</td>
                    <td className="px-4 py-3 text-xs">
                      {oldRole && newRole ? (
                        <span className="flex items-center gap-1">
                          <span className="text-muted-foreground">{oldRole}</span>
                          <ArrowRight className="size-3" />
                          <span className="font-semibold">{newRole}</span>
                        </span>
                      ) : (
                        e.current_role
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {details?.name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-xs">{e.actor_name}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </AppShell>
  );
}
