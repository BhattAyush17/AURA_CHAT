import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { DiagnosticsPage } from "@/components/diagnostics/DiagnosticsPage";

export const Route = createFileRoute("/diagnostics")({
  component: function DiagnosticsLayout() {
    const pathname = useRouterState({ select: (s) => s.location.pathname });
    if (pathname === "/diagnostics") {
      return <DiagnosticsPage />;
    }
    return <Outlet />;
  },
});
