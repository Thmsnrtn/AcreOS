/**
 * Stop-on-reply — the population ratchet (autonomy gap slice 1, CR-036).
 *
 * CR-036 was a reader and a writer that never met: `checkLeadResponded` filtered
 * activity types nothing wrote. This gate keeps them married:
 *
 *   (a) every member of RESPONSE_SOURCES is written by at least one production
 *       code path under server/ (a member nothing writes is the original defect);
 *   (b) checkLeadResponded filters through the canonical set — no second
 *       hard-coded type list inside it;
 *   (c) the inbound writers call the pause next to the write.
 *
 * Source is comment-stripped before any predicate: the explanation of what was
 * removed must not read as the thing itself.
 */
import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import { RESPONSE_SOURCES } from "../../server/services/leadResponse";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = resolve(__dirname, "../..");
const SERVER = join(ROOT, "server");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules") continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const FILES = walk(SERVER).map((p) => ({
  path: relative(ROOT, p),
  src: stripComments(readFileSync(p, "utf8")),
}));
const byPath = (suffix: string) => {
  const f = FILES.find((x) => x.path.endsWith(suffix));
  if (!f) throw new Error(`census: ${suffix} not found in the server population`);
  return f;
};

/**
 * How a member is written. A literal `type: "x"` is the common shape; the two
 * call-outcome members are written through the `${channel}_response` template
 * in the contact-event route, where `channel` is the z.enum(["phone","sms"]).
 */
function writers(member: string): string[] {
  const hits: string[] = [];
  const literal = new RegExp(`type\\s*:\\s*["'\`]${member}["'\`]`);
  const m = member.match(/^(phone|sms)_response$/);
  for (const f of FILES) {
    if (f.path.endsWith("services/leadResponse.ts")) continue; // the list itself
    if (literal.test(f.src)) {
      hits.push(f.path);
      continue;
    }
    if (m && /type\s*:\s*`\$\{channel\}_response`/.test(f.src) && new RegExp(`z\\.enum\\(\\[[^\\]]*["']${m[1]}["']`).test(f.src)) {
      hits.push(f.path);
    }
  }
  return hits;
}

describe("RESPONSE_SOURCES population", () => {
  it("reads a real population (vacuity floor)", () => {
    expect(FILES.length).toBeGreaterThan(300);
    expect(RESPONSE_SOURCES.length).toBeGreaterThanOrEqual(4);
    expect(new Set(RESPONSE_SOURCES).size).toBe(RESPONSE_SOURCES.length);
  });

  it.each([...RESPONSE_SOURCES])("(a) %s is written by at least one production path", (member) => {
    expect(writers(member), `no code under server/ writes lead-activity type "${member}"`).not.toHaveLength(0);
  });

  it("(a) each member's writer is the seam it claims", () => {
    expect(writers("email_received")).toContain("server/services/inboundEmailService.ts");
    expect(writers("sms_received")).toContain("server/services/smsService.ts");
    expect(writers("phone_response")).toContain("server/routes-leads.ts");
    expect(writers("sms_response")).toContain("server/routes-leads.ts");
  });

  it("(b) checkLeadResponded filters through the canonical set, with no second list", () => {
    const src = byPath("services/sequenceProcessor.ts").src;
    const start = src.indexOf("async checkLeadResponded(");
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("clampRetryAt(", start);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body).toContain("isResponseActivityType(");
    expect(body).not.toMatch(/\.type\s*[!=]==?/); // no inline type comparison
    for (const member of RESPONSE_SOURCES) expect(body).not.toContain(member);
    // and the processor takes the predicate from the canonical module
    expect(src).toMatch(/import\s*\{[^}]*isResponseActivityType[^}]*\}\s*from\s*["']\.\/leadResponse["']/);
  });

  it("(c) every inbound writer calls the pause", () => {
    for (const [file, member] of [
      ["server/services/inboundEmailService.ts", "email_received"],
      ["server/services/smsService.ts", "sms_received"],
      ["server/routes-leads.ts", "phone_response"],
    ] as const) {
      const f = byPath(file);
      expect(f.src, `${file} must import the pause`).toMatch(/pauseSequencesOnResponse/);
      expect(f.src, `${file} must call the pause`).toMatch(/await\s+pauseSequencesOnResponse\(/);
      expect(writers(member)).toContain(file);
    }
  });

  it("(c) the route pauses only when the outcome counts as a response", () => {
    const src = byPath("server/routes-leads.ts").src;
    expect(src).toMatch(/if\s*\(\s*callOutcomeIsResponse\(outcome\)\s*\)\s*\{[\s\S]*?pauseSequencesOnResponse\(/);
  });

  it("pauseEnrollmentOnResponse has a production caller (it had none)", () => {
    const callers = FILES.filter(
      (f) => !f.path.endsWith("services/sequenceProcessor.ts") && /pauseEnrollmentOnResponse\(/.test(f.src),
    );
    expect(callers.map((c) => c.path)).toContain("server/services/leadResponse.ts");
  });
});
