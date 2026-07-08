import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
export default { title: "Overlays/Tooltip", component: Tooltip };
export const Default = { render: () => (
  <TooltipProvider><Tooltip><TooltipTrigger asChild><Button variant="outline">Hover me</Button></TooltipTrigger><TooltipContent>Estimated value</TooltipContent></Tooltip></TooltipProvider>
) };
