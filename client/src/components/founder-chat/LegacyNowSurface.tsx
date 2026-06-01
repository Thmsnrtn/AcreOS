/**
 * LegacyNowSurface — stub.
 *
 * Phase F: /founder/now was deleted and /founder/dashboard redirects to
 * /founder/bridge. This symbol is preserved for grep-ability during the
 * eventual removal sweep; it no longer renders anything meaningful.
 */
import { Redirect } from "wouter";

export function LegacyNowSurface() {
  return <Redirect to="/founder/bridge" />;
}

export default LegacyNowSurface;
