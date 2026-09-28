/**
 * PropertyCombobox — pick one of the org's properties, searched on the server
 * (DEFECT-0168).
 *
 * Every property picker used to render useProperties(), which is page 1 of
 * 100: the 101st-newest property could not be chosen for a deal, a note, an
 * offer letter or a document, and "No properties available" could be said
 * over an org with hundreds. This searches the whole book (`?q=`), resolves
 * the selected value by id so an older preselected property still shows its
 * label, and renders a failed search as a failure, not as "none".
 */
import { useEffect, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import type { Property } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { Verbs } from "@/lib/labels";
import { useProperty, usePropertySearch } from "@/hooks/use-properties";

export function propertyLabel(p: Pick<Property, "county" | "state" | "sizeAcres" | "address" | "apn">): string {
  const where = p.address ? p.address : `${p.county}, ${p.state}`;
  return `${where} · APN ${p.apn}${p.sizeAcres ? ` (${p.sizeAcres} ac)` : ""}`;
}

interface PropertyComboboxProps {
  value: number | null | undefined;
  onChange: (id: number, property: Property) => void;
  /** For an optional link: offers "No property" and calls this. */
  onClear?: () => void;
  /** Drop one status from the choices — e.g. "sold" for a new seller-finance note. */
  excludeStatus?: string;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  /** Passed by FormControl so validation messages attach to the control. */
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "data-testid"?: string;
  className?: string;
}

export function PropertyCombobox({
  value,
  onChange,
  onClear,
  excludeStatus,
  placeholder = "Select property",
  disabled,
  id,
  className,
  ...rest
}: PropertyComboboxProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setTerm(input), 250);
    return () => clearTimeout(t);
  }, [input]);

  const search = usePropertySearch(term, { excludeStatus, enabled: open });
  const selected = useProperty(value ?? null);
  const results = (search.data?.data ?? []) as Property[];
  const total = search.data?.total ?? 0;

  // A selected value is always named: loading, missing (404) and unreadable
  // each say so rather than falling back to the placeholder over a form that
  // still holds the id.
  const triggerText = !value
    ? placeholder
    : selected.data
      ? propertyLabel(selected.data) + (selected.data.status === "deleted" ? " (deleted)" : "")
      : selected.isLoading
        ? "Loading property…"
        : selected.data === null
          ? `Property #${value} (not found)`
          : `Property #${value}`;

  return (
    // `modal`: inside a Dialog / Sheet the dialog's scroll lock swallows wheel
    // and touch events on a non-modal portaled popover, so the list could not
    // be scrolled.
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={rest["aria-label"] ?? "Select property"}
          aria-describedby={rest["aria-describedby"]}
          aria-invalid={rest["aria-invalid"]}
          data-testid={rest["data-testid"]}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", !value && "text-muted-foreground", className)}
        >
          <span className="truncate">{triggerText}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[280px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search APN, county, address…" value={input} onValueChange={setInput} />
          <CommandList>
            {search.isError ? (
              <div className="px-3 py-4 text-sm text-muted-foreground" role="alert" data-testid="property-combobox-error">
                Couldn't search properties.{" "}
                <button
                  type="button"
                  className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                  onClick={() => search.refetch()}
                >
                  {Verbs.RETRY}
                </button>
              </div>
            ) : search.isLoading ? (
              <div className="px-3 py-4 text-sm text-muted-foreground">Searching…</div>
            ) : (
              <>
                <CommandEmpty>
                  {term.trim() ? "No matching properties." : excludeStatus ? `No properties that aren't ${excludeStatus}.` : "No properties yet."}
                </CommandEmpty>
                <CommandGroup>
                  {onClear && (
                    <CommandItem
                      value="__none"
                      onSelect={() => {
                        onClear();
                        setOpen(false);
                      }}
                    >
                      <Check className={cn("mr-2 h-4 w-4", !value ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                      No property
                    </CommandItem>
                  )}
                  {results.map((p) => (
                    <CommandItem
                      key={p.id}
                      value={String(p.id)}
                      onSelect={() => {
                        onChange(p.id, p);
                        setOpen(false);
                      }}
                    >
                      <Check className={cn("mr-2 h-4 w-4", value === p.id ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                      <span className="truncate">{propertyLabel(p)}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
                {total > results.length && (
                  <p className="px-3 py-2 text-xs text-muted-foreground" data-testid="property-combobox-more">
                    Showing {results.length} of {total} — type to narrow.
                  </p>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
