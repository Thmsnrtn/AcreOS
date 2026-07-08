import { DealJourney } from "@/components/ui/deal-journey";
export default { title: "Data Display/DealJourney", component: DealJourney };
export const Default = { render: () => <div className="w-96"><DealJourney status="negotiating" /></div> };
