import { Slider } from "@/components/ui/slider";
export default { title: "Forms/Slider", component: Slider };
export const Default = { render: () => <Slider defaultValue={[40]} max={100} step={1} className="w-72" /> };
