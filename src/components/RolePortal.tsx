import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  HardHat,
  ShieldCheck,
  Building2,
  Crown,
  ArrowRight,
  Lock,
  User,
  Check,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useRole } from "@/lib/role-context";
import {
  ROLE_SUMMARY,
  ROLE_LOGIN_CREDENTIALS,
  ROLE_NAV,
  type Role,
} from "@/lib/erp-data";

export const ROLE_ICONS: Record<Role, typeof HardHat> = {
  Supervisor: HardHat,
  Administrator: ShieldCheck,
  A1: Building2,
  "A1+": Crown,
};

export const ROLE_THEME: Record<
  Role,
  { accent: string; soft: string; ring: string; tag: string }
> = {
  Supervisor: {
    accent: "text-blue-600",
    soft: "bg-blue-500/10",
    ring: "border-blue-500/40",
    tag: "bg-blue-600",
  },
  Administrator: {
    accent: "text-emerald-600",
    soft: "bg-emerald-500/10",
    ring: "border-emerald-500/40",
    tag: "bg-emerald-600",
  },
  A1: {
    accent: "text-amber-600",
    soft: "bg-amber-500/10",
    ring: "border-amber-500/40",
    tag: "bg-amber-600",
  },
  "A1+": {
    accent: "text-purple-600",
    soft: "bg-purple-500/10",
    ring: "border-purple-500/40",
    tag: "bg-purple-600",
  },
};

export const ROLE_PORTAL_PATH: Record<Role, "/portal/supervisor" | "/portal/administrator" | "/portal/a1" | "/portal/a1plus"> = {
  Supervisor: "/portal/supervisor",
  Administrator: "/portal/administrator",
  A1: "/portal/a1",
  "A1+": "/portal/a1plus",
};

export const ROLE_LOGIN_PATH: Record<Role, "/login/supervisor" | "/login/administrator" | "/login/a1" | "/login/a1plus"> = {
  Supervisor: "/login/supervisor",
  Administrator: "/login/administrator",
  A1: "/login/a1",
  "A1+": "/login/a1plus",
};

export const ROLE_DASHBOARD: Record<Role, "/supervisor" | "/administrator" | "/a1" | "/a1plus"> = {
  Supervisor: "/supervisor",
  Administrator: "/administrator",
  A1: "/a1",
  "A1+": "/a1plus",
};

function PortalHeader({ role }: { role: Role }) {
  const Icon = ROLE_ICONS[role];
  const theme = ROLE_THEME[role];
  return (
    <header className="border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-4">
        <Link to="/" className="flex items-center gap-2.5">
          <span className={`flex size-9 items-center justify-center rounded-xl ${theme.soft}`}>
            <Icon className={`size-5 ${theme.accent}`} />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-bold">Meditrust ERP</p>
            <p className="text-xs text-muted-foreground">{role} Portal</p>
          </div>
        </Link>
        <Link to="/" className="text-xs font-semibold text-muted-foreground hover:text-foreground">
          All portals
        </Link>
      </div>
    </header>
  );
}

export function RolePortalLanding({
  role,
  tagline,
  workflow,
}: {
  role: Role;
  tagline: string;
  workflow: string[];
}) {
  const theme = ROLE_THEME[role];
  const summary = ROLE_SUMMARY[role];
  const sections = ROLE_NAV[role];

  return (
    <div className="min-h-screen bg-background font-sans">
      <PortalHeader role={role} />
      <main className="mx-auto max-w-5xl px-5 py-12">
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold text-white ${theme.tag}`}
        >
          {role} access level
        </span>
        <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">{tagline}</h1>
        <p className="mt-3 max-w-2xl text-base text-muted-foreground">{summary.scope}</p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild>
            <Link to={ROLE_LOGIN_PATH[role]}>
              Sign in to {role} portal
              <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/">Other role portals</Link>
          </Button>
        </div>

        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <Card className="p-5">
            <h2 className="text-sm font-bold">Approval authority</h2>
            <p className={`mt-2 text-xl font-bold ${theme.accent}`}>{summary.limit}</p>
            <p className="mt-3 text-xs font-semibold text-foreground">Cannot</p>
            <p className="text-xs text-muted-foreground">{summary.cannot}</p>
          </Card>

          <Card className="p-5 lg:col-span-2">
            <h2 className="text-sm font-bold">Sections visible to this role</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {sections.map((s) => (
                <div key={s.to} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Check className={`size-4 ${theme.accent}`} />
                  {s.label}
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              All other modules are blocked for {role} accounts.
            </p>
          </Card>
        </div>

        <Card className="mt-6 p-5">
          <h2 className="text-sm font-bold">Your workflow</h2>
          <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {workflow.map((step, i) => (
              <li key={step} className="flex items-start gap-3 rounded-lg bg-surface p-3">
                <span
                  className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${theme.tag}`}
                >
                  {i + 1}
                </span>
                <span className="text-sm">{step}</span>
              </li>
            ))}
          </ol>
        </Card>
      </main>
    </div>
  );
}

export function RoleLoginPortal({ role }: { role: Role }) {
  const navigate = useNavigate();
  const { login } = useRole();
  const theme = ROLE_THEME[role];
  const Icon = ROLE_ICONS[role];
  const creds = ROLE_LOGIN_CREDENTIALS[role];
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim() === creds.username && password === creds.password) {
      login(role);
      toast.success(`Welcome back, ${role}`);
      navigate({ to: ROLE_DASHBOARD[role] });
    } else {
      toast.error(`Invalid ${role} credentials`);
    }
  };

  return (
    <div className="min-h-screen bg-background font-sans">
      <PortalHeader role={role} />
      <main className="mx-auto flex max-w-md flex-col justify-center px-5 py-12">
        <div className={`flex size-12 items-center justify-center rounded-2xl ${theme.soft}`}>
          <Icon className={`size-6 ${theme.accent}`} />
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">{role} sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This portal only accepts {role} credentials. {ROLE_SUMMARY[role].limit}.
        </p>

        <form onSubmit={handleLogin} className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={`Enter ${role} username`}
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
          <Button type="submit" className="w-full">
            Sign in as {role}
            <ArrowRight className="ml-2 size-4" />
          </Button>
        </form>

        <div className="mt-5 rounded-lg bg-surface p-3 text-xs text-muted-foreground">
          <p className="font-semibold text-foreground">Demo credentials</p>
          <p className="mt-1">
            Username: <span className="font-mono">{creds.username}</span>
          </p>
          <p>
            Password: <span className="font-mono">{creds.password}</span>
          </p>
        </div>

        <Link
          to={ROLE_PORTAL_PATH[role]}
          className="mt-4 text-xs font-semibold text-muted-foreground hover:text-foreground"
        >
          ← Back to {role} portal overview
        </Link>
      </main>
    </div>
  );
}
