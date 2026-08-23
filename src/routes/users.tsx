// User Management — CRUD for system users with role assignment, password reset, and account unlock.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell, StatusPill } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  fetchUsers,
  createUser,
  updateUser,
  deleteUser,
  unlockUser,
  fetchActiveSessions,
  revokeSession,
} from "@/lib/api/users";
import { useRole } from "@/lib/role-context";
import { requireAuth } from "@/lib/auth-guards";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Search,
  Unlock,
  ShieldCheck,
  Lock,
  UserCog,
} from "lucide-react";

export const Route = createFileRoute("/users")({
  head: () => ({
    meta: [
      { title: "User Management — Meditrust ERP" },
      {
        name: "description",
        content: "Manage system users, roles, passwords and account lock status.",
      },
    ],
  }),
  beforeLoad: () => {
    requireAuth();
  },
  component: UsersPage,
});

const ROLE_TONE: Record<string, "info" | "warning" | "success" | "danger"> = {
  Supervisor: "info",
  Administrator: "warning",
  A1: "success",
  "A1+": "danger",
};

// Main user management page with table, create/edit dialog, and unlock/delete actions.
function UsersPage() {
  const queryClient = useQueryClient();
  const { role: currentUserRole } = useRole();

  const { data } = useQuery({ queryKey: ["users"], queryFn: () => fetchUsers() });
  const users = (data?.data ?? []) as any[];

  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState<string | null>(null);

  const [form, setForm] = useState({
    username: "",
    password: "",
    name: "",
    role: "Supervisor" as string,
    phone: "",
  });

  const canManage = currentUserRole === "A1+" || currentUserRole === "Administrator";

  const openCreate = () => {
    setEditing(null);
    setForm({ username: "", password: "", name: "", role: "Supervisor", phone: "" });
    setDialogOpen(true);
  };

  const openEdit = (u: any) => {
    setEditing(u);
    setForm({
      username: u.username ?? "",
      password: "",
      name: u.name ?? "",
      role: u.role ?? "Supervisor",
      phone: u.phone ?? "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.username.trim() || !form.name.trim()) {
      toast.error("Username and name are required");
      return;
    }
    if (!editing && !form.password) {
      toast.error("Password is required for new users");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const updates: any = {
          id: editing.id,
          username: form.username.trim(),
          name: form.name.trim(),
          role: form.role,
          phone: form.phone.trim() || undefined,
        };
        if (form.password) updates.password = form.password;

        const result = await updateUser(updates);
        if (result.success) {
          toast.success("User updated");
          setDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: ["users"] });
        } else {
          toast.error(result.error ?? "Failed to update user");
        }
      } else {
        const result = await createUser({
            username: form.username.trim(),
            password: form.password,
            name: form.name.trim(),
            role: form.role as "Supervisor" | "Administrator" | "A1" | "A1+",
            ...(form.phone.trim() && { phone: form.phone.trim() }),
        });
        if (result.success) {
          toast.success("User created");
          setDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: ["users"] });
        } else {
          toast.error(result.error ?? "Failed to create user");
        }
      }
    } catch {
      toast.error("Failed to save user");
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      const result = await deleteUser({ id });
      if (result.success) {
        toast.success("User deleted");
        queryClient.invalidateQueries({ queryKey: ["users"] });
      } else {
        toast.error(result.error ?? "Failed to delete user");
      }
    } catch {
      toast.error("Failed to delete user");
    }
    setDeleting(null);
  };

  const handleUnlock = async (id: string) => {
    setUnlocking(id);
    try {
      const result = await unlockUser({ id });
      if (result.success) {
        toast.success("Account unlocked");
        queryClient.invalidateQueries({ queryKey: ["users"] });
      } else {
        toast.error(result.error ?? "Failed to unlock user");
      }
    } catch {
      toast.error("Failed to unlock user");
    }
    setUnlocking(null);
  };

  const filtered = users.filter((u: any) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      u.username?.toLowerCase().includes(s) ||
      u.name?.toLowerCase().includes(s) ||
      u.phone?.toLowerCase().includes(s)
    );
  });

  if (!canManage) {
    return (
      <AppShell title="User management" subtitle="Manage system users and roles">
        <Card className="p-8 text-center text-sm text-muted-foreground">
          <Lock className="mx-auto mb-2 size-8 text-muted-foreground" />
          You need Administrator or A1+ privileges to manage users.
        </Card>
      </AppShell>
    );
  }

  const now = new Date();

  return (
    <AppShell
      title="User management"
      subtitle="Manage system users, roles, passwords and lock status"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search users..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56 pl-9"
          />
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1.5 size-4" /> Add user
        </Button>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Username</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    No users found.
                  </td>
                </tr>
              )}
              {filtered.map((u: any) => {
                const isLocked = u.locked_until && new Date(u.locked_until) > now;
                return (
                  <tr key={u.id} className="hover:bg-surface/50">
                    <td className="px-4 py-3 font-medium">{u.name}</td>
                    <td className="px-4 py-3 font-mono text-xs">{u.username}</td>
                    <td className="px-4 py-3">
                      <StatusPill tone={ROLE_TONE[u.role] ?? "info"}>{u.role}</StatusPill>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{u.phone ?? "—"}</td>
                    <td className="px-4 py-3">
                      {isLocked ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
                          <Lock className="size-3" /> Locked
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                          <ShieldCheck className="size-3" /> Active
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {u.created_at ? new Date(u.created_at).toLocaleDateString("en-IN") : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {isLocked && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleUnlock(u.id)}
                            disabled={unlocking === u.id}
                            title="Unlock account"
                          >
                            {unlocking === u.id ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Unlock className="size-3.5" />
                            )}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(u)}
                          title="Edit user"
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(u.id)}
                          disabled={deleting === u.id}
                          title="Delete user"
                        >
                          {deleting === u.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="size-3.5 text-destructive" />
                          )}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit user" : "Add user"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Update user details. Leave password blank to keep current."
                : "Create a new system user with role-based access."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="u-name">Full name *</Label>
                <Input
                  id="u-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. R. Kannan"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="u-username">Username *</Label>
                <Input
                  id="u-username"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  placeholder="e.g. supervisor"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="u-role">Role</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Supervisor">Supervisor</SelectItem>
                    <SelectItem value="Administrator">Administrator</SelectItem>
                    <SelectItem value="A1">A1</SelectItem>
                    <SelectItem value="A1+">A1+</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="u-phone">Phone</Label>
                <Input
                  id="u-phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+91..."
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="u-pass">
                Password{" "}
                {editing ? (
                  <span className="text-muted-foreground">(leave blank to keep current)</span>
                ) : (
                  "*"
                )}
              </Label>
              <Input
                id="u-pass"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Minimum 6 characters"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <UserCog className="mr-2 size-4" />
              )}
              {editing ? "Update user" : "Create user"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Active Sessions Section */}
      <ActiveSessionsSection />
    </AppShell>
  );
}

// Active sessions section with force-revoke capability.
function ActiveSessionsSection() {
  const queryClient = useQueryClient();
  const [revoking, setRevoking] = useState<string | null>(null);

  const { data: sessionsData, isLoading } = useQuery({
    queryKey: ["active-sessions"],
    queryFn: () => fetchActiveSessions(),
  });
  const sessions = sessionsData?.data ?? [];

  const handleRevoke = async (id: string) => {
    if (!confirm("Force-revoke this session? The user will be logged out immediately.")) return;
    setRevoking(id);
    try {
      const result = await revokeSession({ id });
      if (result.success) {
        toast.success("Session revoked");
        queryClient.invalidateQueries({ queryKey: ["active-sessions"] });
      } else {
        toast.error(result.error ?? "Failed to revoke");
      }
    } catch {
      toast.error("Failed to revoke session");
    }
    setRevoking(null);
  };

  return (
    <Card className="mt-4 overflow-hidden p-0">
      <div className="border-b border-border p-4">
        <p className="font-semibold">Active Sessions</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Currently logged-in sessions. Force-revoke to immediately log out a user.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Login Time</th>
              <th className="px-4 py-3 font-medium">Expires</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center">
                  <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
                </td>
              </tr>
            )}
            {!isLoading && sessions.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No active sessions.
                </td>
              </tr>
            )}
            {sessions.map((s: any) => (
              <tr key={s.id} className="hover:bg-surface/50">
                <td className="px-4 py-3 font-medium">{s.user_name}</td>
                <td className="px-4 py-3 text-xs">{s.user_role}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {new Date(s.created_at).toLocaleString("en-IN", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {new Date(s.expires_at).toLocaleString("en-IN", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleRevoke(s.id)}
                    disabled={revoking === s.id}
                  >
                    {revoking === s.id ? <Loader2 className="size-3.5 animate-spin" /> : "Revoke"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
