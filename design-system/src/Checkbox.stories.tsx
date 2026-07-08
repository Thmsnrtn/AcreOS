import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
export default { title: "Forms/Checkbox", component: Checkbox };
export const Default = { render: () => (
  <div className="flex items-center gap-2"><Checkbox id="t" defaultChecked /><Label htmlFor="t">Owner-financed only</Label></div>
) };
