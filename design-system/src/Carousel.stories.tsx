import { Carousel, CarouselContent, CarouselItem, CarouselPrevious, CarouselNext } from "@/components/ui/carousel";
export default { title: "Data Display/Carousel", component: Carousel };
export const Default = { render: () => (
  <Carousel className="w-64"><CarouselContent>
    {[1,2,3].map((i)=>(<CarouselItem key={i}><div className="flex h-32 items-center justify-center rounded-md border text-2xl font-semibold">{i}</div></CarouselItem>))}
  </CarouselContent><CarouselPrevious /><CarouselNext /></Carousel>
) };
