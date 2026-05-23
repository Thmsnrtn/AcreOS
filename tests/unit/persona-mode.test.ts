/**
 * @vitest-environment jsdom
 *
 * Persona-mode hook tests.
 *
 * The hook layers four pieces — localStorage persistence, URL-path
 * inference, navigation, and a "don't fire while typing" gate. Each is
 * exercised through its pure-function entry point so we don't need
 * @testing-library/react (which isn't a dep) to assert behavior.
 *
 * The hook itself wraps these pure helpers with wouter's useLocation +
 * a single useEffect — the rendered behavior is therefore covered by
 * the pure functions plus a couple of integration assertions on the
 * default-path map.
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  PERSONA_MODE_STORAGE_KEY,
  PERSONA_MODE_PATHS,
  inferModeFromPath,
  readStoredMode,
  writeStoredMode,
  isTypingTarget,
} from "../../client/src/hooks/use-persona-mode";

describe("persona-mode pure helpers", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // ── inferModeFromPath ────────────────────────────────────────────────
  describe("inferModeFromPath", () => {
    it("treats /founder as founder mode", () => {
      expect(inferModeFromPath("/founder")).toBe("founder");
    });

    it("treats /founder/anything as founder mode", () => {
      expect(inferModeFromPath("/founder/now")).toBe("founder");
      expect(inferModeFromPath("/founder/inspector/audit")).toBe("founder");
      expect(inferModeFromPath("/founder/cmo")).toBe("founder");
    });

    it("treats /today as customer mode", () => {
      expect(inferModeFromPath("/today")).toBe("customer");
    });

    it("treats /leads, /properties, /money etc as customer mode", () => {
      expect(inferModeFromPath("/leads")).toBe("customer");
      expect(inferModeFromPath("/properties")).toBe("customer");
      expect(inferModeFromPath("/money")).toBe("customer");
      expect(inferModeFromPath("/")).toBe("customer");
    });

    it("does NOT misclassify paths that merely contain 'founder'", () => {
      // /founder-letter is a public landing — not a founder-mode path.
      expect(inferModeFromPath("/founders-club")).toBe("customer");
      expect(inferModeFromPath("/founder-letter")).toBe("customer");
    });
  });

  // ── localStorage round-trip ──────────────────────────────────────────
  describe("localStorage persistence", () => {
    it("writes and reads back 'founder'", () => {
      writeStoredMode("founder");
      expect(localStorage.getItem(PERSONA_MODE_STORAGE_KEY)).toBe("founder");
      expect(readStoredMode()).toBe("founder");
    });

    it("writes and reads back 'customer'", () => {
      writeStoredMode("customer");
      expect(localStorage.getItem(PERSONA_MODE_STORAGE_KEY)).toBe("customer");
      expect(readStoredMode()).toBe("customer");
    });

    it("returns null when nothing is stored", () => {
      expect(readStoredMode()).toBeNull();
    });

    it("returns null (not the garbage) when the stored value is invalid", () => {
      localStorage.setItem(PERSONA_MODE_STORAGE_KEY, "admin");
      expect(readStoredMode()).toBeNull();
    });

    it("survives 'hard refresh' simulation — second read matches first write", () => {
      writeStoredMode("founder");
      // Simulate a page reload: we don't clear storage, just re-read.
      expect(readStoredMode()).toBe("founder");
      writeStoredMode("customer");
      expect(readStoredMode()).toBe("customer");
    });
  });

  // ── PERSONA_MODE_PATHS contract ──────────────────────────────────────
  describe("PERSONA_MODE_PATHS", () => {
    it("maps founder → /founder", () => {
      expect(PERSONA_MODE_PATHS.founder).toBe("/founder");
    });

    it("maps customer → /today", () => {
      expect(PERSONA_MODE_PATHS.customer).toBe("/today");
    });

    it("each target path round-trips back to its own mode via inferModeFromPath", () => {
      expect(inferModeFromPath(PERSONA_MODE_PATHS.founder)).toBe("founder");
      expect(inferModeFromPath(PERSONA_MODE_PATHS.customer)).toBe("customer");
    });
  });

  // ── toggle behavior (modeled as a pure transition) ──────────────────
  describe("toggle reverses mode", () => {
    function toggle(current: "founder" | "customer"): "founder" | "customer" {
      return current === "founder" ? "customer" : "founder";
    }

    it("founder → customer", () => {
      expect(toggle("founder")).toBe("customer");
    });

    it("customer → founder", () => {
      expect(toggle("customer")).toBe("founder");
    });

    it("two toggles are a no-op", () => {
      expect(toggle(toggle("founder"))).toBe("founder");
      expect(toggle(toggle("customer"))).toBe("customer");
    });

    it("toggle target is exactly the OTHER side of PERSONA_MODE_PATHS", () => {
      const fromFounder = toggle("founder");
      expect(PERSONA_MODE_PATHS[fromFounder]).toBe("/today");
      const fromCustomer = toggle("customer");
      expect(PERSONA_MODE_PATHS[fromCustomer]).toBe("/founder");
    });
  });

  // ── isTypingTarget — refusal-to-fire gate for Cmd+; ─────────────────
  describe("isTypingTarget (keyboard-shortcut suppression)", () => {
    it("returns false for null", () => {
      expect(isTypingTarget(null)).toBe(false);
    });

    it("returns false for a plain <div>", () => {
      const div = document.createElement("div");
      expect(isTypingTarget(div)).toBe(false);
    });

    it("returns true for <input>", () => {
      const input = document.createElement("input");
      expect(isTypingTarget(input)).toBe(true);
    });

    it("returns true for <textarea>", () => {
      const ta = document.createElement("textarea");
      expect(isTypingTarget(ta)).toBe(true);
    });

    it("returns true for <select>", () => {
      const sel = document.createElement("select");
      expect(isTypingTarget(sel)).toBe(true);
    });

    it("returns true for contenteditable elements", () => {
      const el = document.createElement("div");
      el.setAttribute("contenteditable", "true");
      // jsdom only reflects isContentEditable when the node is in the
      // tree; attach it before checking.
      document.body.appendChild(el);
      expect(isTypingTarget(el)).toBe(true);
      document.body.removeChild(el);
    });

    it("returns false for a button (so Cmd+; works while a button has focus)", () => {
      const btn = document.createElement("button");
      expect(isTypingTarget(btn)).toBe(false);
    });
  });

  // ── path-based inference + storage interaction ──────────────────────
  describe("path inference + storage interaction", () => {
    it("path is the source of truth — storage that disagrees is reconciled forward", () => {
      // User was last in founder mode (stored), now lands on /today.
      writeStoredMode("founder");
      const pathMode = inferModeFromPath("/today");
      // The hook's reconciliation effect would rewrite storage to match.
      // We assert the contract here: path wins, storage updates.
      writeStoredMode(pathMode);
      expect(readStoredMode()).toBe("customer");
    });

    it("first visit with no stored mode infers from path", () => {
      expect(readStoredMode()).toBeNull();
      const pathMode = inferModeFromPath("/founder/now");
      expect(pathMode).toBe("founder");
    });
  });
});
