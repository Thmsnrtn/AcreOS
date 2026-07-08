import { StatusDot } from "@/components/ui/status-dot";
export default { title: "Feedback/StatusDot", component: StatusDot };
export const Default = { render: () => (
  <div className="flex items-center gap-4 text-sm">
    <StatusDot tone="green" label="Active" />
    <StatusDot tone="amber" label="Pending" />
    <StatusDot tone="red" label="Overdue" />
  </div>
) };
