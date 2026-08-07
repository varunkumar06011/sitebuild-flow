import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ROLES, ROLE_SUMMARY, ROLE_NAV } from "@/lib/erp-data";
import { authStore } from "@/lib/auth-store";
import {
  ROLE_ICONS,
  ROLE_THEME,
  ROLE_PORTAL_PATH,
  ROLE_LOGIN_PATH,
  ROLE_DASHBOARD,
} from "@/components/RolePortal";
import { ArrowRight, HardHat } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Meditrust ERP — Role Portals for Hospital Construction" },
      {
        name: "description",
        content:
          "Separate role portals for Supervisor, Administrator, A1 and A1+ — procurement, approvals, gate pass, traceability, QC and site registers.",
      },
      { property: "og:title", content: "Meditrust ERP — Role Portals" },
      {
        property: "og:description",
        content: "Pick your role portal and sign in to your own ERP workspace.",
      },
    ],
  }),
  beforeLoad: () => {
    const state = authStore.getState();
    if (state.isAuthenticated && state.role) {
      throw redirect({ to: ROLE_DASHBOARD[state.role] });
    }
  },
  component: PortalHub,
});

function PortalHub() {
  return (
    <div className="min-h-screen bg-background font-sans">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center gap-2.5 px-5 py-4">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <HardHat className="size-5" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-bold">Meditrust ERP</p>
            <p className="text-xs text-muted-foreground">Hospital Construction Control</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-14">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Vgrand Multi-speciality Hospital · Phase 2
        </h1>
        <p className="mt-3 max-w-2xl text-base text-muted-foreground">
          Four role portals, four separate workspaces. Every user signs in through their own portal
          and sees only the sections their role permits.
        </p>

        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          {ROLES.map((role) => {
            const Icon = ROLE_ICONS[role];
            const theme = ROLE_THEME[role];
            return (
              <Card key={role} className="flex h-full flex-col p-6">
                <span
                  className={`flex size-11 items-center justify-center rounded-xl ${theme.soft}`}
                >
                  <Icon className={`size-6 ${theme.accent}`} />
                </span>
                <p className="mt-4 text-lg font-bold">{role}</p>
                <p className="mt-1 text-xs font-semibold text-muted-foreground">
                  {ROLE_SUMMARY[role].limit}
                </p>
                <p className="mt-3 flex-1 text-sm text-muted-foreground">
                  {ROLE_SUMMARY[role].scope}
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  {ROLE_NAV[role].length} sections available
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button asChild size="sm">
                    <Link to={ROLE_LOGIN_PATH[role]}>
                      Sign in <ArrowRight className="ml-1.5 size-3.5" />
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link to={ROLE_PORTAL_PATH[role]}>Portal overview</Link>
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      </main>
    </div>
  );
}
