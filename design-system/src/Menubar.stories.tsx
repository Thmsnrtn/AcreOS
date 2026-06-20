import { Menubar, MenubarMenu, MenubarTrigger, MenubarContent, MenubarItem, MenubarSeparator } from "@/components/ui/menubar";
export default { title: "Navigation/Menubar", component: Menubar };
export const Default = { render: () => (
  <Menubar><MenubarMenu><MenubarTrigger>Deal</MenubarTrigger><MenubarContent><MenubarItem>New offer</MenubarItem><MenubarSeparator /><MenubarItem>Export</MenubarItem></MenubarContent></MenubarMenu>
    <MenubarMenu><MenubarTrigger>View</MenubarTrigger><MenubarContent><MenubarItem>Map</MenubarItem><MenubarItem>List</MenubarItem></MenubarContent></MenubarMenu></Menubar>
) };
