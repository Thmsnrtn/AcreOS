import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
export default { title: "Forms/Switch", component: Switch };
export const Default = { render: () => (
  <div className="flex items-center gap-2"><Switch id="s" defaultChecked /><Label htmlFor="s">Auto-publish</Label></div>
) };
