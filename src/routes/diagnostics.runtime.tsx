import { createFileRoute } from "@tanstack/react-router";
import { RuntimeDiagnosticsPage } from "@/components/diagnostics/RuntimeDiagnosticsPage";

export const Route = createFileRoute("/diagnostics/runtime")({
  component: RuntimeDiagnosticsPage,
});
