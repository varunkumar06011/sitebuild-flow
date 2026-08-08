// Vendor Portal Login — separate login for vendor accounts.
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginPortalAccount, PORTAL_COOKIE } from "@/lib/api/portal-auth";
import { Building2, Lock, User, Loader2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/portal/vendor/login")({
  head: () => ({
    meta: [
      { title: "Vendor Portal Login — Meditrust ERP" },
      {
        name: "description",
        content: "Vendor self-service portal for POs, payments, and document uploads.",
      },
    ],
  }),
  component: VendorLoginPage,
});

function VendorLoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await loginPortalAccount({
        data: { username, password, account_type: "vendor" },
      });
      if (result.success) {
        toast.success(`Welcome, ${result.account.name}`);
        document.cookie = `${PORTAL_COOKIE}=${encodeURIComponent(result.token)}; path=/; max-age=${result.maxAge}; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
        window.location.href = "/portal/vendor";
      } else {
        toast.error(result.error);
        if (result.locked) setPassword("");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Login failed");
    }
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-slate-100 p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary">
            <Building2 className="size-7 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Vendor Portal</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to view your POs, payments, and upload documents
          </p>
        </div>

        <form
          onSubmit={handleLogin}
          className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm"
        >
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter vendor username"
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
                <Loader2 className="size-4 animate-spin" /> Signing in…
              </>
            ) : (
              "Sign in to Vendor Portal"
            )}
          </Button>
        </form>

        <div className="text-center">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3" /> Back to main login
          </Link>
        </div>
      </div>
    </div>
  );
}
