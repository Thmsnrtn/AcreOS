import { SidebarProvider, Sidebar, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton } from "@/components/ui/sidebar";
export default { title: "Navigation/Sidebar", component: Sidebar };
export const Default = { render: () => (
  <SidebarProvider><div className="h-64 w-64 border rounded-md overflow-hidden"><Sidebar collapsible="none">
    <SidebarContent><SidebarGroup><SidebarGroupLabel>AcreOS</SidebarGroupLabel><SidebarMenu>
      <SidebarMenuItem><SidebarMenuButton>Today</SidebarMenuButton></SidebarMenuItem>
      <SidebarMenuItem><SidebarMenuButton>Deals</SidebarMenuButton></SidebarMenuItem>
      <SidebarMenuItem><SidebarMenuButton>Finance</SidebarMenuButton></SidebarMenuItem>
    </SidebarMenu></SidebarGroup></SidebarContent></Sidebar></div></SidebarProvider>
) };
