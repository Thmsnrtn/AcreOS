import { AnimatedList, AnimatedListItem } from "@/components/ui/animated-list";
export default { title: "Data Display/AnimatedList", component: AnimatedList };
export const Default = { render: () => (
  <AnimatedList className="w-72 space-y-2">
    <AnimatedListItem><div className="rounded-md border p-3 text-sm">New lead — 40ac, AZ</div></AnimatedListItem>
    <AnimatedListItem><div className="rounded-md border p-3 text-sm">Offer accepted — 12ac, TX</div></AnimatedListItem>
    <AnimatedListItem><div className="rounded-md border p-3 text-sm">Payment received</div></AnimatedListItem>
  </AnimatedList>
) };
