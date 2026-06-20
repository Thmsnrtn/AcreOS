import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
export default { title: "Data Display/Accordion", component: Accordion };
export const Default = { render: () => (
  <Accordion type="single" collapsible className="w-80">
    <AccordionItem value="a"><AccordionTrigger>What is a parcel report?</AccordionTrigger><AccordionContent>A full valuation, comps, and access summary for a parcel.</AccordionContent></AccordionItem>
    <AccordionItem value="b"><AccordionTrigger>How are comps chosen?</AccordionTrigger><AccordionContent>Recent nearby sales of similar acreage and zoning.</AccordionContent></AccordionItem>
  </Accordion>
) };
