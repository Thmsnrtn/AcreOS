import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
export default { title: "Forms/RadioGroup", component: RadioGroup };
export const Default = { render: () => (
  <RadioGroup defaultValue="cash" className="space-y-2">
    <div className="flex items-center gap-2"><RadioGroupItem value="cash" id="r1" /><Label htmlFor="r1">Cash</Label></div>
    <div className="flex items-center gap-2"><RadioGroupItem value="finance" id="r2" /><Label htmlFor="r2">Owner finance</Label></div>
  </RadioGroup>
) };
