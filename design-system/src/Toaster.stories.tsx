import { Toaster } from "@/components/ui/toaster";
export default { title: "Feedback/Toaster", component: Toaster };
export const Default = { render: () => (
  <div className="text-sm text-muted-foreground">Toaster mounts the global toast region.<Toaster /></div>
) };
