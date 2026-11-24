/**
 * Who services these notes — the operator's own declaration.
 *
 * One radio group for both places it is asked: the tape-import commit step
 * (where it is REQUIRED and starts unselected — a pre-selected answer would be
 * the silent default under another name) and the acquired-note page (where it
 * starts at the note's recorded value). The explanation says what the choice
 * turns on and that it is the operator's declaration, never AcreOS's finding.
 */
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SERVICING_ARRANGEMENT_EFFECT, SERVICING_ARRANGEMENT_OPTIONS, isServicingArrangement, type ServicingArrangement } from "@shared/notes/servicingArrangement";

export function ServicingArrangementChoice({
  idPrefix,
  legend,
  value,
  onChange,
  disabled,
}: {
  idPrefix: string;
  legend: string;
  /** null = nothing chosen yet (import step). */
  value: ServicingArrangement | null;
  onChange: (next: ServicingArrangement) => void;
  disabled?: boolean;
}) {
  const descId = `${idPrefix}-effect`;
  return (
    <fieldset className="space-y-2" data-testid={`${idPrefix}-choice`}>
      <legend className="text-sm font-semibold">{legend}</legend>
      <p id={descId} className="text-sm text-muted-foreground">{SERVICING_ARRANGEMENT_EFFECT}</p>
      <RadioGroup
        value={value ?? ""}
        onValueChange={(v) => { if (isServicingArrangement(v)) onChange(v); }}
        aria-describedby={descId}
        aria-label={legend}
        disabled={disabled}
      >
        {SERVICING_ARRANGEMENT_OPTIONS.map((o) => {
          const id = `${idPrefix}-${o.value}`;
          return (
            <div key={o.value} className="flex items-start gap-2">
              <RadioGroupItem id={id} value={o.value} className="mt-0.5" />
              <Label htmlFor={id} className="space-y-0.5 font-normal">
                <span className="block text-sm font-medium">{o.label}</span>
                <span className="block text-xs text-muted-foreground">{o.detail}</span>
              </Label>
            </div>
          );
        })}
      </RadioGroup>
    </fieldset>
  );
}
