import { NavigationMenu, NavigationMenuList, NavigationMenuItem, NavigationMenuTrigger, NavigationMenuContent, NavigationMenuLink } from "@/components/ui/navigation-menu";
export default { title: "Navigation/NavigationMenu", component: NavigationMenu };
export const Default = { render: () => (
  <NavigationMenu><NavigationMenuList>
    <NavigationMenuItem><NavigationMenuTrigger>Deals</NavigationMenuTrigger><NavigationMenuContent><div className="p-3 text-sm w-48"><NavigationMenuLink>Active</NavigationMenuLink><NavigationMenuLink>Archived</NavigationMenuLink></div></NavigationMenuContent></NavigationMenuItem>
  </NavigationMenuList></NavigationMenu>
) };
