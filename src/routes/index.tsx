import { createFileRoute } from "@tanstack/react-router";
import { Dashboard } from "@/components/cortex/dashboard";

export const Route = createFileRoute("/")({
  component: Dashboard,
});
