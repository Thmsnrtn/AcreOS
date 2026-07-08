import type { Meta, StoryObj } from "@storybook/react-vite";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Terminal, AlertTriangle } from "lucide-react";

const meta = {
  title: "Feedback/Alert",
  component: Alert,
  tags: ["autodocs"],
  argTypes: {
    variant: { control: "select", options: ["default", "destructive"] },
  },
} satisfies Meta<typeof Alert>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Alert className="w-96">
      <Terminal className="h-4 w-4" />
      <AlertTitle>Heads up</AlertTitle>
      <AlertDescription>
        Your county data refresh completed — 1,204 new parcels indexed.
      </AlertDescription>
    </Alert>
  ),
};

export const Destructive: Story = {
  render: () => (
    <Alert variant="destructive" className="w-96">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Payment failed</AlertTitle>
      <AlertDescription>
        We couldn't process your card. Update your billing to avoid interruption.
      </AlertDescription>
    </Alert>
  ),
};
