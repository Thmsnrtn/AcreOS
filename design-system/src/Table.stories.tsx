import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableCaption } from "@/components/ui/table";
export default { title: "Data Display/Table", component: Table };
export const Default = { render: () => (
  <Table className="w-96"><TableCaption>Recent deals</TableCaption>
    <TableHeader><TableRow><TableHead>Parcel</TableHead><TableHead>State</TableHead><TableHead className="text-right">Acres</TableHead></TableRow></TableHeader>
    <TableBody>
      <TableRow><TableCell>123-45-678</TableCell><TableCell>AZ</TableCell><TableCell className="text-right">40</TableCell></TableRow>
      <TableRow><TableCell>987-65-432</TableCell><TableCell>TX</TableCell><TableCell className="text-right">12</TableCell></TableRow>
    </TableBody>
  </Table>
) };
