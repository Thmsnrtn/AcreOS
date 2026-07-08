import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
export default { title: "Overlays/DropdownMenu", component: DropdownMenu };
export const Default = { render: () => (
  <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline">Actions</Button></DropdownMenuTrigger>
    <DropdownMenuContent><DropdownMenuLabel>Deal</DropdownMenuLabel><DropdownMenuSeparator /><DropdownMenuItem>Make offer</DropdownMenuItem><DropdownMenuItem>Archive</DropdownMenuItem></DropdownMenuContent>
  </DropdownMenu>
) };
