import { Drawer, DrawerTrigger, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
export default { title: "Overlays/Drawer", component: Drawer };
export const Default = { render: () => (
  <Drawer><DrawerTrigger asChild><Button variant="outline">Open drawer</Button></DrawerTrigger>
    <DrawerContent><DrawerHeader><DrawerTitle>Quick actions</DrawerTitle><DrawerDescription>Act on this parcel.</DrawerDescription></DrawerHeader><DrawerFooter><Button>Done</Button></DrawerFooter></DrawerContent>
  </Drawer>
) };
