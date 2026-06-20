import type { Meta, StoryObj } from "@storybook/react-vite";
import { Label } from "@/components/ui/label";

const meta = {
  title: "Forms/Label",
  component: Label,
  tags: ["autodocs"],
  args: { children: "Email address" },
} satisfies Meta<typeof Label>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithControl: Story = {
  render: () => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="parcel">Parcel ID</Label>
      <input
        id="parcel"
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        placeholder="123-45-678"
      />
    </div>
  ),
};
