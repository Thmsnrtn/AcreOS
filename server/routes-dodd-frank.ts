/**
 * T277 — Dodd-Frank Compliance Routes
 *
 * POST /api/dodd-frank/check — run compliance check for a seller-financed deal
 */

import { Router, type Request, type Response } from "express";
import { checkDoddFrankCompliance } from "./services/doddFrankChecker";
import { Errors } from "./utils/errors";

const router = Router();

router.post("/check", (req: Request, res: Response) => {
  try {
    const {
      sellerFinancedDealsLast12Months,
      sellerType,
      hasDwelling,
      sellerConstructedDwelling,
      isSellerResidence,
      loanTermMonths,
      rateType,
      balloonAfterMonths,
      interestRate,
    } = req.body;

    if (sellerFinancedDealsLast12Months == null || !sellerType || hasDwelling == null || !rateType || interestRate == null) {
      return Errors.badRequest(
        res,
        "Required: sellerFinancedDealsLast12Months, sellerType, hasDwelling, rateType, interestRate",
      );
    }

    const result = checkDoddFrankCompliance({
      sellerFinancedDealsLast12Months,
      sellerType,
      hasDwelling,
      sellerConstructedDwelling: sellerConstructedDwelling ?? false,
      isSellerResidence: isSellerResidence ?? false,
      loanTermMonths: loanTermMonths ?? 60,
      rateType,
      balloonAfterMonths,
      interestRate,
    });

    res.json(result);
  } catch (err: any) {
    Errors.badRequest(res, err.message);
  }
});

export default router;
