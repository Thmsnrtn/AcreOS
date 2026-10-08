/**
 * The request-body copy helpers carry fields over, never a prototype.
 *
 * A JSON body can hold `__proto__` (and `constructor`, `prototype`) as
 * ordinary own keys — `JSON.parse` creates them that way, and express.json()
 * uses JSON.parse. Assigning such a key in a copy loop sets the copy's
 * prototype instead of adding a field, so everything the copy is later read
 * through would see inherited values the server never wrote. Each helper is
 * driven with a parsed body, exactly as a route receives it.
 */
import { describe, it, expect } from "vitest";
import { stripServerOwnedFields } from "../../shared/contracts/serverOwnedFields";
import { omitProtectedFields, omitServerOwnedFields } from "../../server/utils/updatePayload";

const HELPERS: Array<[string, (body: unknown) => Record<string, unknown>]> = [
  ["stripServerOwnedFields", (b) => stripServerOwnedFields(b)],
  ["omitServerOwnedFields", (b) => omitServerOwnedFields(b) as Record<string, unknown>],
  ["omitProtectedFields", (b) => omitProtectedFields<Record<string, unknown>>(b) as Record<string, unknown>],
];

describe.each(HELPERS)("%s", (_name, copy) => {
  it("keeps the ordinary fields and the plain object prototype", () => {
    const body = JSON.parse('{"__proto__":{"isFounder":true,"role":"owner"},"constructor":{"x":1},"prototype":{"y":2},"name":"Kept"}');
    expect(Object.keys(body)).toContain("__proto__");

    const out = copy(body);

    expect(out.name).toBe("Kept");
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect((out as { isFounder?: unknown }).isFounder).toBeUndefined();
    expect((out as { role?: unknown }).role).toBeUndefined();
    expect(Object.keys(out).sort()).toEqual(["name"]);
  });
});
