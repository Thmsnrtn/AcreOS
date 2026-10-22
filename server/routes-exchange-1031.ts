/**
 * T213 — 1031 Exchange Tracker Routes — REFUSED until persistence exists.
 *
 * Every handler here used to call service methods that were stubs
 * (`createExchange` returned `{}`, `listExchanges` returned `[]`), so
 * `POST /api/exchange-1031` answered 201 and the page toasted "1031 exchange
 * tracker created" while nothing was stored — on a feature with hard IRS
 * deadlines (best-in-class audit 2026-10-20, §3 P0 #3). Refuse, never
 * fabricate: each route now answers 501 with the reason, and the stub
 * service (services/exchange1031.ts) is deleted so nothing can call it.
 *
 * To make this real: an `exchanges_1031` table + migration, an org-scoped
 * repo, and a test that a created exchange is read back by the list route.
 */

import { Router, type Request, type Response } from "express";
import { Errors } from "./utils/errors";

export const EXCHANGE_TRACKER_UNAVAILABLE =
  "The 1031 exchange tracker does not store exchanges yet, so it cannot track your 45- and 180-day deadlines. Calendar them with your qualified intermediary.";

const router = Router();

const refuse = (_req: Request, res: Response) => Errors.notImplemented(res, EXCHANGE_TRACKER_UNAVAILABLE);

router.get("/", refuse);
router.post("/", refuse);
router.get("/:id", refuse);
router.post("/:id/identify", refuse);
router.post("/:id/complete", refuse);

export default router;
