export interface Attack { category: string; text: string; heldOut: boolean; round: 1 | 2 }
export function coreHeldOut(core: string): boolean;
export function generateAttacks(): Attack[];
export function isHeldOut(text: string): boolean;
export function pickAttack(prefixes: string[], n: number): Attack;
export const CATEGORIES: string[];
