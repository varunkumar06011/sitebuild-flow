// Parent layout route for all role portal pages; renders nested portal routes via Outlet.
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/portal")({
  component: () => <Outlet />,
});
