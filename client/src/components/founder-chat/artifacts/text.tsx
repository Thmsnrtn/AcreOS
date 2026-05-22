/**
 * text artifact — markdown body.
 *
 * Uses the same minimal markdown parser the property-analysis chat uses
 * (no react-markdown dep in the repo). Headings, lists, code fences,
 * inline bold/italic/code.
 */
import { cn } from "@/lib/utils";

interface TextArtifactProps {
  markdown: string;
  className?: string;
}

function inlineFormat(text: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|__[^_]+__|_[^_]+_)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={idx}
          className="bg-muted px-1 py-0.5 rounded text-[11px] font-mono"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (
      (part.startsWith("**") && part.endsWith("**")) ||
      (part.startsWith("__") && part.endsWith("__"))
    ) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    if (
      (part.startsWith("*") && part.endsWith("*")) ||
      (part.startsWith("_") && part.endsWith("_"))
    ) {
      return <em key={idx}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

export function TextArtifact({ markdown, className }: TextArtifactProps) {
  const lines = (markdown ?? "").split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <pre
          key={`code-${i}`}
          className="bg-muted rounded-md p-2.5 my-1.5 overflow-x-auto text-[11px] font-mono leading-relaxed"
        >
          <code>{codeLines.join("\n")}</code>
        </pre>,
      );
      i++;
      continue;
    }

    const h3 = line.match(/^### (.+)/);
    if (h3) {
      elements.push(
        <h3 key={`h3-${i}`} className="font-semibold text-sm mt-3 mb-1">
          {inlineFormat(h3[1])}
        </h3>,
      );
      i++;
      continue;
    }
    const h2 = line.match(/^## (.+)/);
    if (h2) {
      elements.push(
        <h2
          key={`h2-${i}`}
          className="font-bold text-sm mt-4 mb-1 text-acr-brand"
        >
          {inlineFormat(h2[1])}
        </h2>,
      );
      i++;
      continue;
    }
    const h1 = line.match(/^# (.+)/);
    if (h1) {
      elements.push(
        <h1 key={`h1-${i}`} className="font-bold text-base mt-4 mb-1">
          {inlineFormat(h1[1])}
        </h1>,
      );
      i++;
      continue;
    }

    if (line.match(/^[-*+] /)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^[-*+] /)) {
        items.push(lines[i].replace(/^[-*+] /, ""));
        i++;
      }
      elements.push(
        <ul
          key={`ul-${i}`}
          className="list-disc list-inside space-y-0.5 my-1 pl-1"
        >
          {items.map((it, j) => (
            <li key={j} className="text-sm">
              {inlineFormat(it)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    if (line.match(/^\d+\. /)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^\d+\. /)) {
        items.push(lines[i].replace(/^\d+\. /, ""));
        i++;
      }
      elements.push(
        <ol
          key={`ol-${i}`}
          className="list-decimal list-inside space-y-0.5 my-1 pl-1"
        >
          {items.map((it, j) => (
            <li key={j} className="text-sm">
              {inlineFormat(it)}
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    if (line.match(/^---+$/)) {
      elements.push(<hr key={`hr-${i}`} className="border-border my-2" />);
      i++;
      continue;
    }

    if (line.trim() === "") {
      elements.push(<div key={`sp-${i}`} className="h-1" />);
      i++;
      continue;
    }

    elements.push(
      <p key={`p-${i}`} className="text-sm leading-relaxed">
        {inlineFormat(line)}
      </p>,
    );
    i++;
  }

  return (
    <div className={cn("space-y-0.5", className)} data-testid="artifact-text">
      {elements}
    </div>
  );
}

export default TextArtifact;
