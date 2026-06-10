/**
 * PsychologicalPressureGauge — heuristic seller-motivation read computed from
 * urgency/motivation/hesitation keywords in the pasted seller message.
 * Extracted from pages/negotiation-copilot.tsx (T3 W1-4); hardcoded hex gauge
 * colors replaced with semantic tokens (acr-pos/acr-warn/muted) so the gauge
 * themes correctly in light and dark.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Gauge } from 'lucide-react';
import type { SentimentResult, ObjectionResult } from './meta';

export function PsychologicalPressureGauge({
  sellerMessage,
  sentiment,
}: {
  sellerMessage: string;
  sentiment: SentimentResult | null;
  objection: ObjectionResult | null;
}) {
  // Calculate pressure score from signals
  const urgencySignals = ["must", "need", "deadline", "quick", "fast", "asap", "soon", "urgent"].filter(
    (w) => sellerMessage.toLowerCase().includes(w)
  ).length;
  const motivationSignals = ["sell", "move", "estate", "divorce", "taxes", "behind", "foreclos"].filter(
    (w) => sellerMessage.toLowerCase().includes(w)
  ).length;
  const hesitationSignals = ["think", "maybe", "not sure", "consider", "wait", "discuss", "talk"].filter(
    (w) => sellerMessage.toLowerCase().includes(w)
  ).length;

  const sentimentBoost = sentiment ? (sentiment.score > 0.3 ? 15 : sentiment.score < -0.3 ? -10 : 0) : 0;
  const rawPressure = Math.min(100, Math.max(0,
    20 + urgencySignals * 15 + motivationSignals * 20 - hesitationSignals * 10 + sentimentBoost
  ));

  const pressureLabel = rawPressure >= 70 ? "High Motivation" : rawPressure >= 40 ? "Moderate" : "Low Urgency";
  // Semantic token classes — the SVG arc inherits via stroke="currentColor".
  const pressureClass = rawPressure >= 70 ? "text-acr-pos" : rawPressure >= 40 ? "text-acr-warn" : "text-muted-foreground";

  if (!sellerMessage.trim()) return null;

  const r = 45;
  const circ = Math.PI * r; // semicircle
  const dash = (rawPressure / 100) * circ;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Gauge className="w-4 h-4 text-primary" aria-hidden="true" />
          Seller motivation gauge
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center">
          {/* SVG semicircle gauge */}
          <div
            className="relative w-32 h-16 overflow-hidden"
            role="progressbar"
            aria-label={`Seller motivation: ${pressureLabel}`}
            aria-valuenow={Math.round(rawPressure)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext={`${Math.round(rawPressure)} out of 100, ${pressureLabel}`}
          >
            <svg viewBox="0 0 100 50" className="w-full h-full" aria-hidden="true">
              {/* Background arc */}
              <path
                d="M 5 50 A 45 45 0 0 1 95 50"
                fill="none"
                stroke="hsl(var(--muted))"
                strokeWidth="8"
                strokeLinecap="round"
              />
              {/* Value arc — currentColor follows the semantic pressure class */}
              <path
                d="M 5 50 A 45 45 0 0 1 95 50"
                fill="none"
                className={pressureClass}
                stroke="currentColor"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${dash} ${circ}`}
              />
            </svg>
            <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">
              <span className={`text-2xl font-bold tabular-nums ${pressureClass}`}>{Math.round(rawPressure)}</span>
            </div>
          </div>
          <p className={`text-sm font-semibold mt-1 ${pressureClass}`}>{pressureLabel}</p>
          <dl className="grid grid-cols-3 gap-2 mt-3 w-full text-center m-0">
            <div>
              <dd className="text-lg font-bold tabular-nums text-acr-warn m-0">{urgencySignals}</dd>
              <dt className="text-micro text-muted-foreground">Urgency signals</dt>
            </div>
            <div>
              <dd className="text-lg font-bold tabular-nums text-acr-pos m-0">{motivationSignals}</dd>
              <dt className="text-micro text-muted-foreground">Motivation cues</dt>
            </div>
            <div>
              <dd className="text-lg font-bold tabular-nums text-muted-foreground m-0">{hesitationSignals}</dd>
              <dt className="text-micro text-muted-foreground">Hesitation signs</dt>
            </div>
          </dl>
        </div>
      </CardContent>
    </Card>
  );
}
