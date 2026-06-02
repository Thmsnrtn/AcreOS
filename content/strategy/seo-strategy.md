# AcreOS SEO Strategy

## Informational Keywords (Drive Traffic via Content)

### "average cost per acre [state]"
- **Monthly search volume:** 5,000-15,000 (varies by state — "average cost per acre texas" alone is ~8,000/mo)
- **Competition:** Medium (government sites, real estate portals)
- **Target page:** /market-data — dynamic page showing county-by-county land values pulled from USDA NASS
- **Optimization:** Create state-specific landing pages with real data tables, updated quarterly. Internal link to signup for full county analysis.

### "is my property in a flood zone"
- **Monthly search volume:** 12,000-18,000
- **Competition:** Medium (FEMA is #1, but their UX is terrible)
- **Target page:** Free flood zone lookup tool — enter an address, get instant FEMA NFHL result
- **Optimization:** Simple, fast tool. No signup required. Capture email for "full DD report" upsell.

### "land investing due diligence checklist"
- **Monthly search volume:** 1,500-3,000
- **Competition:** Low-Medium (blog posts, no interactive tools)
- **Target page:** Blog post with downloadable checklist + link to automated DD reports
- **Optimization:** Comprehensive checklist with 25+ items. Each item links to the relevant free data source. CTA: "Or let AcreOS run this checklist automatically."

### "seller financing dodd frank"
- **Monthly search volume:** 800-1,500
- **Competition:** Low (legal sites, few investor-focused resources)
- **Target page:** Blog post (content/blog/seller-finance-guide.md)
- **Optimization:** Practical, plain-language guide. Cover the 3 key rules, exemptions, and penalties. Internal link to AcreOS compliance checker.

### "how to seller finance land"
- **Monthly search volume:** 2,500-4,000
- **Competition:** Medium (YouTube videos, blog posts)
- **Target page:** Blog post (content/blog/seller-finance-guide.md)
- **Optimization:** Step-by-step guide with math examples. Include amortization calculator embed. CTA to AcreOS note management.

---

## Transactional Keywords (Capture Users Ready to Buy)

### "land investing software"
- **Monthly search volume:** 500-1,200
- **Competition:** Medium (Pebble, REsimpli, PropStream ads)
- **Target page:** Landing page — acreos.io or acreos.io/land-investing-software
- **Optimization:** Feature comparison table. Testimonials (once available). Free trial CTA. "18 free data sources" and "Land Credit Score" as differentiators.

### "land investing CRM"
- **Monthly search volume:** 400-800
- **Competition:** Medium
- **Target page:** Landing page with CRM-specific features highlighted
- **Optimization:** Screenshots of lead management, pipeline view, campaign tools. Compare to general CRMs (HubSpot, etc.) and land-specific tools (Pebble).

### "seller finance note management software"
- **Monthly search volume:** 200-500
- **Competition:** Low (very few dedicated tools)
- **Target page:** /features/note-management — dedicated feature page
- **Optimization:** Emphasize: amortization, borrower portal, Dodd-Frank compliance, dunning. This is a blue ocean keyword — very few competitors target it.

### "alternative to pebble rei"
- **Monthly search volume:** 100-300
- **Competition:** Low
- **Target page:** /compare/pebble — comparison page
- **Optimization:** Honest, specific comparison. "What Pebble does well, what it doesn't, and how AcreOS fills the gaps." Include pricing comparison. Don't trash Pebble — respect the competitor, differentiate on features.

### "propstream alternative"
- **Monthly search volume:** 300-600
- **Competition:** Low-Medium
- **Target page:** /compare/propstream — comparison page
- **Optimization:** Position AcreOS as "PropStream data + CRM + campaigns + notes in one platform." Highlight the 18 free data sources vs. PropStream's paid lookups.

---

## Content Calendar for SEO

### Month 1
- Publish: "18 Free Data Sources" (targets informational keywords)
- Publish: "Seller Financing Guide" (targets "seller financing dodd frank" + "how to seller finance land")
- Publish: "How I Automate My Land Investing Pipeline" (targets "land investing software")
- Create: /market-data page with state-level data (targets "average cost per acre")

### Month 2
- Publish: "Land Investing Due Diligence: The Complete Checklist" (new blog post)
- Publish: "Pebble vs AcreOS: Honest Comparison" (targets "alternative to pebble rei")
- Publish: "PropStream vs AcreOS: Data Platform vs Operating System" (targets "propstream alternative")
- Create: Free flood zone lookup tool (targets "is my property in a flood zone")

### Month 3
- Publish: "County Analysis: Best Counties for Land Investing in 2026" (new blog post, targets state-specific keywords)
- Publish: "How the Land Credit Score Works" (targets "land credit score" as branded keyword)
- Create: Note management feature page (targets "seller finance note management software")
- Begin building backlinks: guest posts on land investing blogs, podcast appearances → link back to AcreOS

---

## Technical SEO Checklist

- [ ] Meta titles and descriptions on all pages (< 60 chars title, < 160 chars description)
- [ ] Open Graph and Twitter Card meta tags for social sharing
- [ ] Sitemap.xml generated and submitted to Google Search Console
- [ ] robots.txt configured (allow all public pages, block /api/)
- [ ] Canonical URLs on all pages
- [ ] Structured data (JSON-LD) for blog posts (Article schema)
- [ ] Page speed optimization: images lazy-loaded, CSS/JS minified, Vite production build
- [ ] Mobile-responsive on all pages (critical for Google's mobile-first indexing)
- [ ] Internal linking between blog posts, feature pages, and comparison pages
