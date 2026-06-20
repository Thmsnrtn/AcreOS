import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
export default { title: "Navigation/Tabs", component: Tabs };
export const Default = { render: () => (
  <Tabs defaultValue="overview" className="w-80">
    <TabsList><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="comps">Comps</TabsTrigger></TabsList>
    <TabsContent value="overview" className="text-sm text-muted-foreground pt-2">40 acres · residential · county-road access.</TabsContent>
    <TabsContent value="comps" className="text-sm text-muted-foreground pt-2">3 nearby sales in the last 90 days.</TabsContent>
  </Tabs>
) };
