import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
export default { title: "Layout/Collapsible", component: Collapsible };
export const Default = { render: () => (
  <Collapsible className="w-72" defaultOpen>
    <CollapsibleTrigger asChild><Button variant="outline" size="sm">Toggle details</Button></CollapsibleTrigger>
    <CollapsibleContent className="mt-2 rounded-md border p-3 text-sm text-muted-foreground">Zoning: residential · Access: county road · Water: well required.</CollapsibleContent>
  </Collapsible>
) };
