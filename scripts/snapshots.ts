#!/usr/bin/env tsx
/*
  DEV snapshots utility
  - Fetches key API endpoints from a local AcreOS dev server (DEV_MODE=true)
  - Saves results to logs/snapshots/<ISO_DATE>/ as JSON for reproducible audits
*/
import fs from 'node:fs/promises'
import path from 'node:path'

const PORT = parseInt(process.env.PORT || '5000', 10)
const BASE = process.env.ACREOS_BASE_URL || `http://localhost:${PORT}`

const endpoints = [
  '/api/organization',
  '/api/dashboard/stats',
  '/api/dashboard/intelligence',
  '/api/recent-items',
]

async function main() {
  const ts = new Date().toISOString().replace(/[:]/g, '-')
  const dir = path.join('logs', 'snapshots', ts)
  await fs.mkdir(dir, { recursive: true })

  for (const ep of endpoints) {
    const url = `${BASE}${ep}`
    try {
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } })
      const text = await res.text()
      const ok = res.ok
      const out = {
        url,
        ok,
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        body: (() => { try { return JSON.parse(text) } catch { return text } })(),
        capturedAt: new Date().toISOString(),
      }
      const name = ep.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'root'
      await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify(out, null, 2))
      console.log(`✔ Captured ${ep} -> ${path.join(dir, name + '.json')}`)
    } catch (err) {
      const name = ep.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'root'
      const out = { url, error: String(err), capturedAt: new Date().toISOString() }
      await fs.writeFile(path.join(dir, `${name}.error.json`), JSON.stringify(out, null, 2))
      console.error(`✖ Failed ${ep}:`, err)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
