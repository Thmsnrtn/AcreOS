import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbSeparator, BreadcrumbPage } from "@/components/ui/breadcrumb";
export default { title: "Navigation/Breadcrumb", component: Breadcrumb };
export const Default = { render: () => (
  <Breadcrumb><BreadcrumbList>
    <BreadcrumbItem><BreadcrumbLink href="#">Deals</BreadcrumbLink></BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem><BreadcrumbLink href="#">Arizona</BreadcrumbLink></BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem><BreadcrumbPage>Parcel 123-45-678</BreadcrumbPage></BreadcrumbItem>
  </BreadcrumbList></Breadcrumb>
) };
