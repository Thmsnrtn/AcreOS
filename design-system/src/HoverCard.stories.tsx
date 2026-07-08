import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { Button } from "@/components/ui/button";
export default { title: "Overlays/HoverCard", component: HoverCard };
export const Default = { render: () => (
  <HoverCard><HoverCardTrigger asChild><Button variant="link">@coconino_county</Button></HoverCardTrigger>
    <HoverCardContent className="text-sm">Public records source for Coconino County, AZ.</HoverCardContent></HoverCard>
) };
