import { ResponsiveModal, ResponsiveModalTrigger, ResponsiveModalContent, ResponsiveModalHeader, ResponsiveModalTitle, ResponsiveModalDescription } from "@/components/ui/responsive-modal";
import { Button } from "@/components/ui/button";
export default { title: "Overlays/ResponsiveModal", component: ResponsiveModal };
export const Default = { render: () => (
  <ResponsiveModal><ResponsiveModalTrigger asChild><Button>Open</Button></ResponsiveModalTrigger>
    <ResponsiveModalContent><ResponsiveModalHeader><ResponsiveModalTitle>Confirm</ResponsiveModalTitle><ResponsiveModalDescription>Dialog on desktop, drawer on mobile.</ResponsiveModalDescription></ResponsiveModalHeader></ResponsiveModalContent></ResponsiveModal>
) };
