import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
export default { title: "Forms/Select", component: Select };
export const Default = { render: () => (
  <Select defaultValue="az"><SelectTrigger className="w-48"><SelectValue placeholder="State" /></SelectTrigger>
    <SelectContent><SelectItem value="az">Arizona</SelectItem><SelectItem value="tx">Texas</SelectItem><SelectItem value="nm">New Mexico</SelectItem></SelectContent></Select>
) };
