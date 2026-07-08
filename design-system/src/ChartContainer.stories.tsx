import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Bar, BarChart, XAxis } from "recharts";
export default { title: "Data Display/ChartContainer", component: ChartContainer };
const data = [{m:"Jan",v:12},{m:"Feb",v:19},{m:"Mar",v:7},{m:"Apr",v:24},{m:"May",v:18}];
const config = { v: { label: "Deals", color: "hsl(var(--primary))" } };
export const Default = { render: () => (
  <ChartContainer config={config} className="h-48 w-80">
    <BarChart data={data}><XAxis dataKey="m" tickLine={false} axisLine={false} /><ChartTooltip content={<ChartTooltipContent />} /><Bar dataKey="v" fill="var(--color-v)" radius={4} /></BarChart>
  </ChartContainer>
) };
