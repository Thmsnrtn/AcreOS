import { ScrollArea } from "@/components/ui/scroll-area";
export default { title: "Data Display/ScrollArea", component: ScrollArea };
export const Default = { render: () => (
  <ScrollArea className="h-36 w-72 rounded-md border p-3 text-sm">
    {Array.from({length:20}).map((_,i)=> <div key={i} className="py-1 border-b last:border-0">Parcel row {i+1}</div>)}
  </ScrollArea>
) };
