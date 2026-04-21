#!/usr/bin/env tsx
import { db } from "../../server/db";
import { companyAgents } from "../../shared/schema";
async function main() {
  const rows = await db.select().from(companyAgents);
  console.log("agent count:", rows.length);
  console.log("codenames:", rows.map(r => r.codename).join(", "));
  process.exit(0);
}
main().catch(err => { console.error(err); process.exit(1); });
