import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRole } from "@/lib/role-context";
import { authStore } from "@/lib/auth-store";
import { loginUser, verifySession } from "@/lib/auth-server";
import { supabase } from "@/lib/supabase";
import { HardHat, Lock, User, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
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
  beforeLoad: async () => {
    // On the client, if authStore says not authenticated (e.g. user just
    // logged out), skip the server-side session check to avoid a redirect
    // loop between /login and the dashboard route guards.
    if (typeof window !== "undefined") {
      const state = authStore.getState();
      if (!state.isAuthenticated) return;
    }
    try {
      const session = await verifySession();
      if (session.authenticated && session.user) {
        const routes = {
          Supervisor: "/supervisor",
          Administrator: "/administrator",
          A1: "/a1",
          "A1+": "/a1plus",
        } as const;
        throw redirect({ to: routes[session.user.role] });
      }
    } catch (e: any) {
      if (e && typeof e === "object" && "status" in e) throw e;
    }
  },
  component: LoginPage,
});

function LoginPage() {
  const { setUser } = useRole();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      toast.error("Enter username and password");
      return;
    }
    setLoading(true);
    try {
      const result = await loginUser({ username, password });
      if (result.success) {
        setUser({ role: result.user.role, name: result.user.name });
        if (result.supabaseSession) {
          await supabase.auth.setSession({
            access_token: result.supabaseSession.access_token,
            refresh_token: result.supabaseSession.refresh_token,
          });
        }
        toast.success(`Welcome back, ${result.user.name}`);
        const routes = {
          Supervisor: "/supervisor",
          Administrator: "/administrator",
          A1: "/a1",
          "A1+": "/a1plus",
        } as const;
        window.location.href = routes[result.user.role];
      } else {
        toast.error(result.error);
        if (result.locked) {
          setPassword("");
        }
      }
    } catch (err) {
      toast.error("Login failed. Please try again.");
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
            <h2 className="text-2xl font-bold tracking-tight">Sign in</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter your credentials to access your dashboard.
            </p>
          </div>

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
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
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
        </div>
      </div>
    </div>
  );
}
