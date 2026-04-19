import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { Decision, UIObservation } from './types.js';

// ── Constants ───────────────────────────────────────────────────────────────

const ACTION_TIMEOUT_MS = 15_000;
const VISIBLE_TEXT_LIMIT = 3_000;

// ── BrowserController ───────────────────────────────────────────────────────

export class BrowserController {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private consoleErrors: string[] = [];

  /**
   * Launch a Chromium browser with the given options.
   */
  async launch(opts: {
    headless: boolean;
    viewport: { width: number; height: number };
  }): Promise<void> {
    this.browser = await chromium.launch({ headless: opts.headless });
    this.context = await this.browser.newContext({
      viewport: opts.viewport,
      locale: 'en-US',
    });
    this.page = await this.context.newPage();

    // Default action timeout
    this.page.setDefaultTimeout(ACTION_TIMEOUT_MS);

    // Capture console.error messages
    this.page.on('console', (msg) => {
      if (msg.type() === 'error') {
        this.consoleErrors.push(msg.text());
      }
    });

    // Capture uncaught page errors
    this.page.on('pageerror', (err) => {
      this.consoleErrors.push(`[PageError] ${err.message}`);
    });
  }

  /**
   * Navigate to a URL and return the resulting observation.
   */
  async navigate(url: string): Promise<UIObservation> {
    const page = this.getPage();
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: ACTION_TIMEOUT_MS,
    });
    // Brief settle time for client-side rendering
    await page.waitForTimeout(500);
    return this.observe();
  }

  /**
   * Click an element matching the selector and return the resulting observation.
   */
  async click(selector: string): Promise<UIObservation> {
    const page = this.getPage();
    await page.click(selector, { timeout: ACTION_TIMEOUT_MS });
    // Wait for any navigation or rendering triggered by the click
    await page.waitForTimeout(300);
    return this.observe();
  }

  /**
   * Type text into an element matching the selector and return the resulting observation.
   */
  async type(selector: string, text: string): Promise<UIObservation> {
    const page = this.getPage();
    await page.fill(selector, text, { timeout: ACTION_TIMEOUT_MS });
    return this.observe();
  }

  /**
   * Scroll the page in the given direction and return the resulting observation.
   */
  async scroll(direction: 'up' | 'down'): Promise<UIObservation> {
    const page = this.getPage();
    const delta = direction === 'down' ? 600 : -600;
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(300);
    return this.observe();
  }

  /**
   * Capture the current page state: screenshot, visible text, URL, title,
   * and any console errors collected since the last observation.
   */
  async observe(): Promise<UIObservation> {
    const page = this.getPage();

    // Capture screenshot as base64 PNG (full page)
    const screenshotBuffer = await page.screenshot({
      type: 'png',
      fullPage: false, // Viewport only — matches what the persona sees
    });
    const screenshot = screenshotBuffer.toString('base64');

    // Extract visible text, truncated
    let visibleText = '';
    try {
      const rawText = await page.innerText('body', { timeout: 5_000 });
      visibleText = rawText.slice(0, VISIBLE_TEXT_LIMIT);
    } catch {
      // Page might be in a state where body isn't available
      visibleText = '[Unable to extract text]';
    }

    // Drain collected console errors
    const errors = [...this.consoleErrors];
    this.consoleErrors = [];

    return {
      screenshot,
      url: page.url(),
      title: await page.title(),
      visibleText,
      consoleErrors: errors,
      timestamp: Date.now(),
    };
  }

  /**
   * Execute a Decision by dispatching to the appropriate action method.
   * Returns the observation after the action completes.
   */
  async executeAction(action: Decision): Promise<UIObservation> {
    switch (action.type) {
      case 'click':
        return this.click(action.selector);

      case 'type':
        return this.type(action.selector, action.text);

      case 'navigate':
        return this.navigate(action.url);

      case 'scroll':
        return this.scroll(action.direction);

      case 'wait': {
        const page = this.getPage();
        await page.waitForTimeout(action.ms);
        return this.observe();
      }

      case 'abandon':
      case 'complete':
        // Terminal actions — just observe the current state
        return this.observe();

      default: {
        const exhaustiveCheck: never = action;
        throw new Error(`Unknown action type: ${(exhaustiveCheck as Record<string, unknown>).type}`);
      }
    }
  }

  /**
   * Close the browser and release resources.
   */
  async close(): Promise<void> {
    if (this.page) {
      await this.page.close().catch(() => {});
      this.page = null;
    }
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
    this.consoleErrors = [];
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private getPage(): Page {
    if (!this.page) {
      throw new Error(
        'BrowserController: page not initialized. Call launch() first.',
      );
    }
    return this.page;
  }
}
