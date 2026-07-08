import { ConversionFunnel } from "@/components/ui/conversion-funnel";
export default { title: "Data Display/ConversionFunnel", component: ConversionFunnel };
export const Default = { render: () => (
  <div className="w-96"><ConversionFunnel stages={[
    {key:"leads",label:"Leads",count:1200,color:"hsl(var(--primary))"},
    {key:"qualified",label:"Qualified",count:480,color:"hsl(var(--primary))"},
    {key:"offers",label:"Offers",count:120,color:"hsl(var(--primary))"},
    {key:"closed",label:"Closed",count:34,color:"hsl(var(--primary))"},
  ]} /></div>
) };
