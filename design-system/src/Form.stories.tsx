import { useForm } from "react-hook-form";
import { Form, FormField, FormItem, FormLabel, FormControl, FormDescription, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
export default { title: "Forms/Form", component: Form };
export const Default = { render: () => {
  const form = useForm({ defaultValues: { parcel: "" } });
  return (
    <Form {...form}><form className="w-72 space-y-2">
      <FormField control={form.control} name="parcel" render={({ field }) => (
        <FormItem><FormLabel>Parcel ID</FormLabel><FormControl><Input placeholder="123-45-678" {...field} /></FormControl><FormDescription>The county APN.</FormDescription><FormMessage /></FormItem>
      )} />
    </form></Form>
  );
} };
