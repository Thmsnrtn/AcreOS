import { AspectRatio } from "@/components/ui/aspect-ratio";
export default { title: "Layout/AspectRatio", component: AspectRatio };
export const Default = { render: () => (
  <div className="w-80"><AspectRatio ratio={16/9} className="rounded-md bg-muted flex items-center justify-center text-sm text-muted-foreground">16 / 9</AspectRatio></div>
) };
