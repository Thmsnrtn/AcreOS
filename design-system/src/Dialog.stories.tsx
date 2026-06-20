import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
export default { title: "Overlays/Dialog", component: Dialog };
export const Default = { render: () => (
  <Dialog><DialogTrigger asChild><Button>Make offer</Button></DialogTrigger>
    <DialogContent><DialogHeader><DialogTitle>Make an offer</DialogTitle><DialogDescription>Send a blind offer to the owner.</DialogDescription></DialogHeader>
      <DialogFooter><Button>Send offer</Button></DialogFooter>
    </DialogContent></Dialog>
) };
