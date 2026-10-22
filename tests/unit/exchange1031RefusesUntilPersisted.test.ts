/**
 * The 1031 tracker must refuse, not fake success (best-in-class audit
 * 2026-10-20, §3 P0 #3).
 *
 * It used to answer `201 { exchange: {} }` to a create and `[]` to every list,
 * because the service's persistence methods were stubs. The falsifiable
 * property is "no route reports a 2xx while storing nothing": every route is
 * driven through the real router and must answer 501 with the reason.
 */

import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import router, { EXCHANGE_TRACKER_UNAVAILABLE } from "../../server/routes-exchange-1031";
import { existsSync, readFileSync } from "node:fs";

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    (req as any).organization = { id: 1 };
    (req as any).user = { id: "u1" };
    next();
  });
  a.use("/api/exchange-1031", router);
  return a;
}

describe("1031 exchange tracker refuses until it can persist", () => {
  const cases: Array<[string, string, object?]> = [
    ["get", "/api/exchange-1031"],
    ["post", "/api/exchange-1031", { relinquishedPropertyAddress: "1 Main", relinquishedSalePriceCents: 100 }],
    ["get", "/api/exchange-1031/1"],
    ["post", "/api/exchange-1031/1/identify", { address: "2 Main", estimatedPriceCents: 100 }],
    ["post", "/api/exchange-1031/1/complete"],
  ];
  for (const [verb, path, body] of cases) {
    it(`${verb.toUpperCase()} ${path} answers 501 with the reason`, async () => {
      const req = (request(app()) as any)[verb](path);
      const res = body ? await req.send(body) : await req;
      expect(res.status).toBe(501);
      expect(res.body.message).toBe(EXCHANGE_TRACKER_UNAVAILABLE);
    });
  }

  it("the stub service is deleted, so nothing can call its fake persistence", () => {
    // services/exchange1031.ts held the stubs (createExchange returned {}).
    // With the routes refusing, nothing imported it, so it is gone.
    expect(existsSync("server/services/exchange1031.ts")).toBe(false);
    expect(readFileSync("server/routes-exchange-1031.ts", "utf8")).not.toMatch(/from "\.\/services\/exchange1031"/);
  });
});
