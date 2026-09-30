/**
 * "Not the sample book" predicates (DEFECT-0137).
 *
 * "Try with sample data" seeds leads, properties, deals and notes that are
 * marked (onboarding/sampleSeeder.ts): leads carry source "sample_data" (the
 * older enhancements seeder used "sample"), properties an APN starting
 * "SAMPLE-", and deals and notes hang off those properties. Anything that
 * measures what the CUSTOMER did — the getting-started checklist, milestone
 * celebrations — must exclude them, or one click reads as a customer's first
 * lead, first deal and first closed deal.
 */
import { sql, type SQL } from "drizzle-orm";
import { deals, leads, notes, payments, properties } from "@shared/schema";
import { SAMPLE_APN_PREFIX, SAMPLE_LEAD_SOURCE } from "./sampleSeeder";

const SAMPLE_APN_LIKE = `${SAMPLE_APN_PREFIX}%`;

export const realLead = (): SQL =>
  sql`coalesce(${leads.source}, '') NOT IN (${SAMPLE_LEAD_SOURCE}, 'sample')`;

export const realProperty = (): SQL =>
  sql`coalesce(${properties.apn}, '') NOT LIKE ${SAMPLE_APN_LIKE}`;

export const realDeal = (): SQL =>
  sql`NOT EXISTS (SELECT 1 FROM ${properties} WHERE ${properties.id} = ${deals.propertyId} AND ${properties.apn} LIKE ${SAMPLE_APN_LIKE})`;

export const realNote = (): SQL =>
  sql`NOT EXISTS (SELECT 1 FROM ${properties} WHERE ${properties.id} = ${notes.propertyId} AND ${properties.apn} LIKE ${SAMPLE_APN_LIKE})`;

/** A payment on a real note (sample payments hang off sample notes). */
export const realPayment = (): SQL =>
  sql`NOT EXISTS (SELECT 1 FROM ${notes} JOIN ${properties} ON ${properties.id} = ${notes.propertyId} WHERE ${notes.id} = ${payments.noteId} AND ${properties.apn} LIKE ${SAMPLE_APN_LIKE})`;
