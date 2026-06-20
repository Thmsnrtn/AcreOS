import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
export default { title: "Data Display/Avatar", component: Avatar };
export const Default = { render: () => (
  <div className="flex gap-3 items-center">
    <Avatar><AvatarImage src="https://i.pravatar.cc/80?img=12" alt="" /><AvatarFallback>TN</AvatarFallback></Avatar>
    <Avatar><AvatarFallback>AC</AvatarFallback></Avatar>
  </div>
) };
