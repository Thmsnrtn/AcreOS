// Pins the short-term-rental (STR) checkout emitter (STR Wave A): the turnover
// template is dead until this emitter fires. This fixes the truth — the event
// carries ONLY real reservation fields plus real joins (property address, unit
// label when a unitId is set, org name), a null passes through as null (never a
// fabricated value), and it emits on the "property" entity (entityId =
// properties.id). No guest email is ever in the payload.
//
// emitReservationCheckout resolves its payload from real joins, so the db is
// stubbed with a chainable mock routed by the select projection's keys (each
// resolver selects a distinctive column).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({
  emitStrEvent: vi.fn(),
  rows: { current: {} as Record<string, any[]> },
}));

vi.mock("../../server/services/workflow-engine", () => ({
  emitStrEvent: H.emitStrEvent,
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// A chainable db whose terminal `await` resolves to a result routed by the
// distinctive keys of the `.select({...})` projection each resolver uses.
vi.mock("../../server/db", () => {
  const pick = (keys: string[]): any[] => {
    const r = H.rows.current;
    if (keys.includes("address")) return r.property ?? [];
    if (keys.includes("name")) return r.org ?? [];
    if (keys.includes("label")) return r.unit ?? [];
    return [];
  };
  const chain = (proj: any) => {
    const keys = proj ? Object.keys(proj) : [];
    const c: any = {
      from: () => c,
      where: () => c,
      limit: () => c,
      then: (res: any, rej: any) => Promise.resolve(pick(keys)).then(res, rej),
    };
    return c;
  };
  return { db: { select: (proj: any) => chain(proj) } };
});

import {
  emitReservationCheckout,
  type ReservationCheckoutInput,
} from "../../server/services/strEvents";

/** Let the fire-and-forget async emitter drain its (already-resolved) reads. */
const flush = () => new Promise((r) => setTimeout(r, 0));

const input = (over: Partial<ReservationCheckoutInput> = {}): ReservationCheckoutInput => ({
  organizationId: 7,
  reservationId: "res_1",
  propertyId: 42,
  unitId: "unit_1",
  guestName: "Jordan Lee",
  checkOut: "2026-06-15",
  channel: "airbnb",
  ...over,
});

beforeEach(() => {
  H.emitStrEvent.mockClear();
  H.rows.current = {};
});
afterEach(() => vi.clearAllMocks());

describe("emitReservationCheckout (reservation.checkout)", () => {
  it("fires with only real fields, on the property entity (entityId = propertyId)", async () => {
    H.rows.current = {
      property: [{ address: "9 Shoreline Dr" }],
      org: [{ name: "Bluewater Stays" }],
      unit: [{ label: "Cabin A" }],
    };
    emitReservationCheckout(input());
    await flush();

    expect(H.emitStrEvent).toHaveBeenCalledTimes(1);
    const [event, orgId, entityId, data] = H.emitStrEvent.mock.calls[0];
    expect(event).toBe("reservation.checkout");
    expect(orgId).toBe(7);
    expect(entityId).toBe(42); // properties.id — the numeric entity handle
    expect(data.reservationId).toBe("res_1");
    expect(data.propertyAddress).toBe("9 Shoreline Dr");
    expect(data.unitLabel).toBe("Cabin A");
    expect(data.guestName).toBe("Jordan Lee");
    expect(data.checkOutDate).toBe("2026-06-15");
    expect(data.channel).toBe("airbnb");
    expect(data.orgName).toBe("Bluewater Stays");
    // There is never a guest email in the payload (no guest mail on the platform sender).
    expect(data.guestEmail).toBeUndefined();
    expect(data.tenantEmail).toBeUndefined();
  });

  it("a stay with no unit resolves unitLabel to null (never a fabricated label)", async () => {
    H.rows.current = {
      property: [{ address: "9 Shoreline Dr" }],
      org: [{ name: "Bluewater Stays" }],
      unit: [{ label: "Cabin A" }], // present, but must NOT be used when unitId is null
    };
    emitReservationCheckout(input({ unitId: null }));
    await flush();
    const data = H.emitStrEvent.mock.calls[0][3];
    expect(data.unitLabel).toBeNull();
  });

  it("null guest / channel / address pass through as null, never guessed", async () => {
    H.rows.current = { property: [], org: [], unit: [] };
    emitReservationCheckout(input({ guestName: null, channel: null, unitId: null }));
    await flush();
    const data = H.emitStrEvent.mock.calls[0][3];
    expect(data.guestName).toBeNull();
    expect(data.channel).toBeNull();
    expect(data.propertyAddress).toBeNull();
    expect(data.orgName).toBeNull();
    expect(data.unitLabel).toBeNull();
    // The checkout date is always real — a checkout has a date.
    expect(data.checkOutDate).toBe("2026-06-15");
  });
});
