import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  read: vi.fn(),
  findBrand: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
}))
vi.mock("../../server/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: h.read }) }),
    query: { brandProfiles: { findFirst: h.findBrand } },
    update: h.update,
    insert: h.insert,
  },
}))
import {
  readConversionSummary,
  getConversionSummary,
} from "../../server/services/autopilot/attribution"
import { seedAcreosBrandProfile } from "../../server/services/cmo/brandProfiles"

beforeEach(() => vi.resetAllMocks())

describe("growth reporting", () => {
  it("distinguishes an unavailable source from a successful empty read", async () => {
    h.read.mockRejectedValueOnce(new Error("database unavailable"))
    await expect(readConversionSummary()).rejects.toThrow("database unavailable")
    h.read.mockResolvedValueOnce([])
    await expect(readConversionSummary()).resolves.toEqual({ totalSignups: 0, byPlay: [] })
  })
  it("counts actual rows and preserves the background fallback", async () => {
    h.read.mockResolvedValueOnce([
      { playId: "field-notes" },
      { playId: "field-notes" },
      { playId: null },
    ])
    await expect(readConversionSummary()).resolves.toEqual({
      totalSignups: 3,
      byPlay: [
        { playId: "field-notes", signups: 2 },
        { playId: "unknown", signups: 1 },
      ],
    })
    h.read.mockRejectedValueOnce(new Error("database unavailable"))
    await expect(getConversionSummary()).resolves.toEqual({ totalSignups: 0, byPlay: [] })
  })
  it("preserves founder positioning and audience across repeated seeding", async () => {
    const edited = {
      id: 7,
      oneLiner: "Founder positioning",
      audiencePrimary: "Land buyers in Texas",
      autoGenerationEnabled: false,
    }
    h.findBrand.mockResolvedValue(edited)
    await expect(seedAcreosBrandProfile()).resolves.toBe(edited)
    await expect(seedAcreosBrandProfile()).resolves.toBe(edited)
    expect(h.update).not.toHaveBeenCalled()
    expect(h.insert).not.toHaveBeenCalled()
  })
})
