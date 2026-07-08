import { Separator } from "@/components/ui/separator";
export default { title: "Layout/Separator", component: Separator };
export const Default = { render: () => (
  <div className="w-72 text-sm"><div>Above</div><Separator className="my-3" /><div>Below</div></div>
) };
