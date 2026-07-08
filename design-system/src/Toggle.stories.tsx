import { Toggle } from "@/components/ui/toggle";
import { Star } from "lucide-react";
export default { title: "Forms/Toggle", component: Toggle };
export const Default = { render: () => <Toggle aria-label="Favorite"><Star className="h-4 w-4" /></Toggle> };
