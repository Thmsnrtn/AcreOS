/**
 * EmbedToolCard — turns a free public tool into a backlink + distribution engine.
 *
 * Free-traffic motion #2 (the snowball): the /tools/*\/embed routes are already
 * iframe-friendly. This surfaces a one-click "Embed this free tool" snippet on
 * the public tool page so bloggers, county sites, and forum posts can drop the
 * tool into their own site — giving AcreOS backlinks (SEO), referral traffic,
 * and brand. Every embed carries the "Powered by AcreOS" backlink + utm tags
 * the embed page already renders.
 */
import { useState } from "react";
import { Copy, Check, Code2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

/** Canonical public origin — matches the OpenGraph URLs on the tool pages. */
const CANONICAL_ORIGIN = "https://acreos.io";

export function EmbedToolCard({
  embedPath,
  title,
  height = 640,
}: {
  /** e.g. "/tools/parcel-check/embed" */
  embedPath: string;
  /** Human title for the iframe + heading, e.g. "Parcel Check". */
  title: string;
  height?: number;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const snippet = `<iframe src="${CANONICAL_ORIGIN}${embedPath}" width="100%" height="${height}" style="border:1px solid rgba(0,0,0,0.1);border-radius:12px" title="Free ${title} by AcreOS" loading="lazy"></iframe>`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      toast({ title: "Embed code copied", description: `Paste it into your site to add the free ${title}.` });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Couldn't copy", description: "Select the code and copy it manually." });
    }
  }

  return (
    <section className="mt-10 rounded-xl border border-border bg-card p-4 sm:p-5" aria-labelledby="embed-tool-heading">
      <div className="flex items-center gap-2">
        <Code2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 id="embed-tool-heading" className="text-sm font-semibold text-foreground">
          Embed this free tool on your site
        </h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Free for any blog, county site, or forum — your readers get the {title}, and it stays free. Copy the snippet:
      </p>
      <pre className="mt-3 overflow-x-auto rounded-lg bg-muted p-3 text-xs leading-relaxed text-foreground">
        <code>{snippet}</code>
      </pre>
      <Button onClick={copy} variant="outline" size="sm" className="mt-3" aria-label="Copy embed code">
        {copied ? <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
        {copied ? "Copied" : "Copy embed code"}
      </Button>
    </section>
  );
}
