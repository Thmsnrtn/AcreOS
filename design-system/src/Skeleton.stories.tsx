import { Skeleton } from "@/components/ui/skeleton";
export default { title: "Feedback/Skeleton", component: Skeleton };
export const Default = { render: () => (
  <div className="w-72 space-y-2"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-20 w-full" /><Skeleton className="h-4 w-2/3" /></div>
) };
