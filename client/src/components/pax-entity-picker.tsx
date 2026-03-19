import { useState, useEffect, useRef } from "react";
import { Users, MapPin, Building } from "lucide-react";

export interface MentionedEntity {
  type: "lead" | "property" | "deal";
  id: number;
  name: string;
  preview: string;
}

interface EntityPickerProps {
  query: string;
  onSelect: (entity: MentionedEntity) => void;
  onClose: () => void;
}

const TYPE_ICONS = {
  lead: Users,
  property: MapPin,
  deal: Building,
};

export function PaxEntityPicker({ query, onSelect, onClose }: EntityPickerProps) {
  const [results, setResults] = useState<MentionedEntity[]>([]);
  const [highlighted, setHighlighted] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!query) { setResults([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/ai/search-entities?q=${encodeURIComponent(query)}&type=all&limit=6`,
          { credentials: "include" }
        );
        if (r.ok) setResults(await r.json());
      } catch {}
    }, 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  useEffect(() => { setHighlighted(0); }, [results]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setHighlighted((h) => Math.min(h + 1, results.length - 1)); }
      if (e.key === "ArrowUp")   { e.preventDefault(); setHighlighted((h) => Math.max(h - 1, 0)); }
      if (e.key === "Enter")     { e.preventDefault(); if (results[highlighted]) onSelect(results[highlighted]); }
      if (e.key === "Escape")    { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [results, highlighted, onSelect, onClose]);

  if (results.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 bg-background border border-border rounded-lg shadow-lg z-50 overflow-hidden">
      <div className="px-3 py-1.5 border-b">
        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Mention an entity</p>
      </div>
      {results.map((entity, i) => {
        const Icon = TYPE_ICONS[entity.type];
        return (
          <button
            key={`${entity.type}-${entity.id}`}
            onClick={() => onSelect(entity)}
            className={`w-full text-left flex items-start gap-2 px-3 py-2 text-xs transition-colors ${
              i === highlighted ? "bg-primary/10 text-primary" : "hover:bg-muted/50"
            }`}
          >
            <Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{entity.name}</p>
              <p className="text-[10px] text-muted-foreground truncate">{entity.preview}</p>
            </div>
            <span className="text-[9px] text-muted-foreground/60 capitalize flex-shrink-0 mt-0.5">{entity.type}</span>
          </button>
        );
      })}
    </div>
  );
}
