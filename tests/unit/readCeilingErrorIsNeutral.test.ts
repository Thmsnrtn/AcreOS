/**
 * W10.2b audit — a whole-book read past its ceiling is refused with ONE error
 * class, worded for what the caller is doing, and answered 413.
 *
 * wholeBookReads' refusal said "This X export exceeds 250,000 rows — contact
 * support for a bulk export" while the same pager served the focus list, due
 * diligence, comps (whose message reaches the model), the parcel backfill and
 * list scrubbing. G's own pager threw a plain Error (a 500) for the same
 * condition. Now both throw ReadCeilingError (server/storage/readCeiling.ts):
 * neutral by default, "export" wording only when the caller says so, and
 * Errors.internal maps it — and the legacy ExportTooLargeError name — to 413.
 */
import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => ({ total: 0 }));
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("../../server/db", () => {
  const select = () => {
    let afterId = 0;
    const q: Record<string, unknown> = {};
    q.from = () => q;
    q.where = (w: unknown) => {
      const params = new PgDialect().sqlToQuery(w as never).params;
      afterId = Number(params[params.length - 1]);
      return q;
    };
    q.orderBy = () => q;
    q.limit = async (n: number) => {
      const end = Math.min(h.total, afterId + n);
      return Array.from({ length: Math.max(0, end - afterId) }, (_, i) => ({ id: afterId + i + 1 }));
    };
    return q;
  };
  return { db: { select } };
});

import { readAllLeads, readAllPages, readAllProperties } from "../../server/storage/wholeBookReads";
import { READ_ROW_CEILING, ReadCeilingError } from "../../server/storage/readCeiling";
import { Errors } from "../../server/utils/errors";

/** A pager that never ends: every page is full. */
const endless = async (afterId: number) => Array.from({ length: 1000 }, (_, k) => ({ id: afterId + k + 1 }));

function fakeRes() {
  const out: { status?: number; body?: Record<string, unknown> } = {};
  const res = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: Record<string, unknown>) {
      out.body = body;
      return res;
    },
    getHeader: () => undefined,
    locals: {},
  };
  return { res: res as never, out };
}

describe("ReadCeilingError — neutral by default, export only when the caller says so", () => {
  it("readAllPages refuses past the ceiling with the neutral wording (no 'export', no 'bulk export')", async () => {
    const err = await readAllPages("due-diligence properties", endless).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReadCeilingError);
    expect((err as ReadCeilingError).statusCode).toBe(413);
    expect((err as ReadCeilingError).code).toBe("READ_TOO_LARGE");
    expect((err as Error).message).toBe(
      "This read exceeds 250,000 due-diligence properties rows — too many to process in one request; nothing was truncated.",
    );
    expect((err as Error).message).not.toMatch(/export/i);
  });

  it("an export still says export", async () => {
    const err = await readAllPages("leads", endless, "export").catch((e: unknown) => e);
    expect((err as ReadCeilingError).code).toBe("EXPORT_TOO_LARGE");
    expect((err as Error).message).toMatch(/^This leads export exceeds 250,000 rows — contact support for a bulk export; nothing was truncated\.$/);
  });

  it("the readAll* readers carry the caller's purpose through (default: neutral)", async () => {
    h.total = READ_ROW_CEILING + 1;
    const neutral = await readAllLeads(7).catch((e: unknown) => e);
    expect((neutral as Error).message).not.toMatch(/export/i);
    const exp = await readAllLeads(7, { purpose: "export" }).catch((e: unknown) => e);
    expect((exp as Error).message).toMatch(/leads export exceeds/);
    const props = await readAllProperties(7, { purpose: "export" }).catch((e: unknown) => e);
    expect((props as Error).message).toMatch(/properties export exceeds/);
  });

  it("exactly the ceiling is not refused (it is 'more than', not 'at')", async () => {
    h.total = READ_ROW_CEILING;
    // A full last page means one more (empty) read; the set is whole.
    expect(await readAllPages("leads", async (afterId) => {
      const end = Math.min(h.total, afterId + 1000);
      return Array.from({ length: Math.max(0, end - afterId) }, (_, i) => ({ id: afterId + i + 1 }));
    })).toHaveLength(READ_ROW_CEILING);
  });
});

describe("Errors.internal answers the refusal with 413 and its message", () => {
  it("ReadCeilingError → 413 READ_TOO_LARGE / EXPORT_TOO_LARGE, message as-is", () => {
    const read = fakeRes();
    Errors.internal(read.res, new ReadCeilingError("comps properties"));
    expect(read.out.status).toBe(413);
    expect(read.out.body).toMatchObject({ error: "READ_TOO_LARGE", statusCode: 413 });
    expect(String(read.out.body?.message)).toMatch(/exceeds 250,000 comps properties rows/);

    const exp = fakeRes();
    Errors.internal(exp.res, new ReadCeilingError("notes", "export"));
    expect(exp.out.status).toBe(413);
    expect(exp.out.body).toMatchObject({ error: "EXPORT_TOO_LARGE" });
  });

  it("the legacy ExportTooLargeError name still maps to 413 EXPORT_TOO_LARGE", () => {
    const legacy = new Error("This leads export exceeds 250,000 rows");
    legacy.name = "ExportTooLargeError";
    const r = fakeRes();
    Errors.internal(r.res, legacy);
    expect(r.out.status).toBe(413);
    expect(r.out.body).toMatchObject({ error: "EXPORT_TOO_LARGE", message: legacy.message });
  });
});

describe("the export callers say they are exporting", () => {
  it("every whole-book read in the exporters passes the export purpose", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { stripComments } = await import("../helpers/stripComments");
    const read = (f: string) => stripComments(fs.readFileSync(path.resolve(__dirname, "../..", f), "utf8"));
    const exporter = read("server/services/importExport.ts");
    const calls = [...exporter.matchAll(/\breadAll(?:Leads|Properties|Deals|Notes|Payments)\(([^)]*)\)/g)];
    expect(calls.length, "vacuity: the exporters read the whole book").toBeGreaterThanOrEqual(8);
    for (const m of calls) expect(m[1], m[0]).toMatch(/purpose:\s*"export"/);
    expect(read("server/services/dataPortability.ts")).toMatch(/readAllPages\(kind, read, "export"\)/);
  });
});
