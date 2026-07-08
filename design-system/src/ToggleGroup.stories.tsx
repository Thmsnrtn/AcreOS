import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
export default { title: "Forms/ToggleGroup", component: ToggleGroup };
export const Default = { render: () => (
  <ToggleGroup type="single" defaultValue="map">
    <ToggleGroupItem value="map">Map</ToggleGroupItem>
    <ToggleGroupItem value="list">List</ToggleGroupItem>
    <ToggleGroupItem value="grid">Grid</ToggleGroupItem>
  </ToggleGroup>
) };
