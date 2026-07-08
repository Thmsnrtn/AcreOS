import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
export default { title: "Overlays/Command", component: Command };
export const Default = { render: () => (
  <Command className="w-72 rounded-lg border"><CommandInput placeholder="Search…" /><CommandList><CommandEmpty>No results.</CommandEmpty><CommandGroup heading="Deals"><CommandItem>Make offer</CommandItem><CommandItem>Export</CommandItem></CommandGroup></CommandList></Command>
) };
