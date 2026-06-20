import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
export default { title: "Layout/ResizablePanelGroup", component: ResizablePanelGroup };
export const Default = { render: () => (
  <ResizablePanelGroup direction="horizontal" className="w-96 h-32 rounded-lg border">
    <ResizablePanel defaultSize={50}><div className="flex h-full items-center justify-center text-sm">Map</div></ResizablePanel>
    <ResizableHandle withHandle />
    <ResizablePanel defaultSize={50}><div className="flex h-full items-center justify-center text-sm">Details</div></ResizablePanel>
  </ResizablePanelGroup>
) };
