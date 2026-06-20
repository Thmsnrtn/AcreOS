import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
export default { title: "Overlays/Popover", component: Popover };
export const Default = { render: () => (
  <Popover><PopoverTrigger asChild><Button variant="outline">Details</Button></PopoverTrigger>
    <PopoverContent className="text-sm">Zoning: residential · Access: county road.</PopoverContent></Popover>
) };
