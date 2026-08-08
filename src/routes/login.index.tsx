import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useRole } from "@/lib/role-context";
import { ROLES, ROLE_SUMMARY, type Role } from "@/lib/erp-data";
import { authStore } from "@/lib/auth-store";
import { loginUser } from "@/lib/auth-server";
import { ROLE_DASHBOARD } from "@/components/RolePortal";
import {
  HardHat,
  Lock,
  User,
  ArrowRight,
  ShieldCheck,
  Building2,
  Crown,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/login/")({
  head: () => ({
    meta: [
      { title: "Login — Meditrust ERP" },
      {
        name: "description",
        content:
          "Role-based login portal for Hospital Construction ERP: Supervisor, Administrator, A1 and A1+.",
      },
    ],
  }),
  beforeLoad: () => {
    if (typeof window === "undefined") return;
    const state = authStore.getState();
    if (state.isAuthenticated && state.role) {
      throw redirect({ to: ROLE_DASHBOARD[state.role] });
    }
  },
  component: LoginPage,
});

const ROLE_ICONS: Record<Role, typeof HardHat> = {
  Supervisor: HardHat,
  Administrator: ShieldCheck,
  A1: Building2,
  "A1+": Crown,
};

const ROLE_ACCENTS: Record<Role, string> = {
  Supervisor: "border-blue-500/40 bg-blue-500/5",
  Administrator: "border-emerald-500/40 bg-emerald-500/5",
  A1: "border-amber-500/40 bg-amber-500/5",
  "A1+": "border-purple-500/40 bg-purple-500/5",
};

function LoginPage() {
  const { setUser } = useRole();
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleRoleSelect = (role: Role) => {
    setSelectedRole(role);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRole) {
      toast.error("Please select a role first");
      return;
    }
    setLoading(true);
    try {
      const result = await loginUser({ data: { username, password } });
      if (result.success) {
        if (result.user.role !== selectedRole) {
          toast.error(
            `These credentials belong to ${result.user.role}, not ${selectedRole}. Please select the correct role.`,
          );
          setLoading(false);
          return;
        }
        setUser({ role: result.user.role, name: result.user.name });
        toast.success(`Welcome back, ${result.user.name}`);
        window.location.href = ROLE_DASHBOARD[result.user.role as Role];
      } else {
        toast.error(result.error);
        if (result.locked) {
          setPassword("");
        }
      }
    } catch (err) {
      console.error("Login error:", err);
      toast.error(err instanceof Error ? err.message : "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background lg:flex-row">
      {/* Left panel — branding */}
      <div className="relative flex flex-col justify-between overflow-hidden bg-primary p-8 text-primary-foreground lg:w-[45%] lg:p-12">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute -right-20 -top-20 size-96 rounded-full bg-white" />
          <div className="absolute -bottom-32 -left-10 size-80 rounded-full bg-white" />
        </div>
        <div className="relative">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary-foreground/15">
              <HardHat className="size-6" />
            </span>
            <div>
              <p className="text-lg font-bold">Meditrust ERP</p>
              <p className="text-sm text-primary-foreground/70">Hospital Construction Control</p>
            </div>
          </div>
        </div>
        <div className="relative space-y-4">
          <h1 className="text-3xl font-bold leading-tight lg:text-4xl">
            Vgrand Multi-speciality Hospital
          </h1>
          <p className="text-base text-primary-foreground/80">Phase 2 · 320 beds · 4 blocks</p>
          <div className="flex flex-wrap gap-2 pt-2">
            {["Procurement", "Approvals", "Gate Pass", "Traceability", "QC", "Registers"].map(
              (tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-primary-foreground/15 px-3 py-1 text-xs font-medium"
                >
                  {tag}
                </span>
              ),
            )}
          </div>
        </div>
        <div className="relative text-xs text-primary-foreground/60">
          <p>Role-based access control</p>
          <p className="mt-1">Immutable audit trail · OTP & QR validation</p>
        </div>
      </div>

      {/* Right panel — login */}
      <div className="flex flex-1 items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md space-y-6">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Sign in to your portal</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Select your role and enter credentials to access your dashboard.
            </p>
          </div>

          {/* Role selection cards */}
          <div className="grid grid-cols-2 gap-3">
            {ROLES.map((role) => {
              const Icon = ROLE_ICONS[role];
              const isSelected = selectedRole === role;
              return (
                <button
                  key={role}
                  onClick={() => handleRoleSelect(role)}
                  className={`flex flex-col items-start gap-2 rounded-xl border-2 p-4 text-left transition-all ${
                    isSelected
                      ? `${ROLE_ACCENTS[role]} ring-2 ring-primary/20`
                      : "border-border hover:border-border/80 hover:bg-surface"
                  }`}
                >
                  <Icon
                    className={`size-6 ${isSelected ? "text-primary" : "text-muted-foreground"}`}
                  />
                  <div>
                    <p className="text-sm font-bold">{role}</p>
                    <p className="text-xs text-muted-foreground">{ROLE_SUMMARY[role].limit}</p>
                  </div>
                </button>
              );
            })}
          </div>

          <Separator />

          {/* Login form */}
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter username"
                  className="pl-9"
                  autoComplete="username"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  className="pl-9"
                  autoComplete="current-password"
                />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={!selectedRole || loading}>
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  Sign in
                  <ArrowRight className="ml-2 size-4" />
                </>
              )}
            </Button>
          </form>

          {/* Portal links */}
          <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
            <a href="/portal/vendor/login" className="hover:text-foreground hover:underline">
              Vendor Portal
            </a>
            <span>·</span>
            <a href="/portal/client/login" className="hover:text-foreground hover:underline">
              Client Portal
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
