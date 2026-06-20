import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from "@/components/ui/context-menu";
export default { title: "Overlays/ContextMenu", component: ContextMenu };
export const Default = { render: () => (
  <ContextMenu><ContextMenuTrigger className="flex h-24 w-72 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">Right-click here</ContextMenuTrigger>
    <ContextMenuContent><ContextMenuItem>Make offer</ContextMenuItem><ContextMenuItem>Copy parcel id</ContextMenuItem></ContextMenuContent></ContextMenu>
) };
