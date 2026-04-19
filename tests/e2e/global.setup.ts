import { clerkSetup } from "@clerk/testing/playwright"
import { FullConfig } from "@playwright/test"

export default async function globalSetup(config: FullConfig) {
  await clerkSetup({
    frontendApiUrl: process.env.PLAYWRIGHT_BASE_URL ?? "https://acreos.io",
  })
}
