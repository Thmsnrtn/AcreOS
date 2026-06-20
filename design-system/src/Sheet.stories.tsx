import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
export default { title: "Overlays/Sheet", component: Sheet };
export const Default = { render: () => (
  <Sheet><SheetTrigger asChild><Button variant="outline">Open filters</Button></SheetTrigger>
    <SheetContent><SheetHeader><SheetTitle>Filters</SheetTitle><SheetDescription>Refine your parcel search.</SheetDescription></SheetHeader></SheetContent>
  </Sheet>
) };
