/**
 * /compare/acreos-vs-dealmachine — SEO lander targeting "dealmachine
 * alternative" search intent. See ComparisonPage.tsx for scaffold notes
 * and the noindex guard that stays on until founder writes positioning.
 */

import { ComparisonPage, type ComparisonConfig } from "./ComparisonPage";

const CONFIG: ComparisonConfig = {
  slug: "acreos-vs-dealmachine",
  competitor: "DealMachine",
  h1: "AcreOS vs DealMachine",
  metaDescription:
    "Comparing AcreOS and DealMachine for land + property investors — CRM, comps, direct mail, automated due diligence, and seller-financed note servicing in one platform.",
  matrix: [
    { capability: "Land-specific parcel intelligence", acreos: true, competitor: null },
    { capability: "Driving-for-dollars list capture", acreos: null, competitor: null },
    { capability: "Built-in direct mail (yellow letters)", acreos: true, competitor: null },
    { capability: "AI-drafted seller replies", acreos: true, competitor: null },
    { capability: "Seller-financed note servicing", acreos: true, competitor: null },
    { capability: "Subdivision + lot-pricing tooling", acreos: true, competitor: null },
    { capability: "Pipeline + deal close workflow", acreos: true, competitor: null },
    {
      capability: "Free tier",
      acreos: true,
      competitor: null,
      note: "AcreOS ships a free tier with the core list-pull + CRM loop.",
    },
  ],
};

export default function AcreosVsDealmachinePage() {
  return <ComparisonPage config={CONFIG} />;
}
