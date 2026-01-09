export type ActionType = 
  | "navigate"
  | "click"
  | "fill"
  | "select"
  | "submit"
  | "scroll"
  | "hover"
  | "wait"
  | "highlight"
  | "focus";

export interface Action {
  id: string;
  type: ActionType;
  target?: string;
  value?: string;
  description?: string;
  delay?: number;
}

export interface ActionResult {
  success: boolean;
  action: Action;
  error?: string;
  timestamp: Date;
}

export interface ActionExecutorOptions {
  speed: 0.5 | 1 | 2;
  onActionStart?: (action: Action) => void;
  onActionComplete?: (result: ActionResult) => void;
  onHighlight?: (element: Element | null, action: Action) => void;
  onNarration?: (text: string) => void;
}

const BASE_DELAY = 500;

function getDelay(speed: number, customDelay?: number): number {
  const baseDelay = customDelay || BASE_DELAY;
  return Math.round(baseDelay / speed);
}

function findElement(target: string): Element | null {
  if (target.startsWith("testid:")) {
    const testId = target.slice(7);
    return document.querySelector(`[data-testid="${testId}"]`);
  }
  
  if (target.startsWith("id:")) {
    const id = target.slice(3);
    return document.getElementById(id);
  }
  
  if (target.startsWith("css:")) {
    const selector = target.slice(4);
    return document.querySelector(selector);
  }
  
  if (target.startsWith("text:")) {
    const text = target.slice(5).toLowerCase();
    const elements = Array.from(document.querySelectorAll("button, a, [role='button'], span, label, h1, h2, h3, h4, h5, h6, p"));
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      if (el.textContent?.toLowerCase().includes(text)) {
        return el;
      }
    }
    return null;
  }
  
  return document.querySelector(`[data-testid="${target}"]`) || 
         document.getElementById(target) ||
         document.querySelector(target);
}

function scrollToElement(element: Element): void {
  element.scrollIntoView({
    behavior: "smooth",
    block: "center",
    inline: "center",
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class ActionExecutor {
  private speed: 0.5 | 1 | 2 = 1;
  private isPaused = false;
  private isCancelled = false;
  private onActionStart?: (action: Action) => void;
  private onActionComplete?: (result: ActionResult) => void;
  private onHighlight?: (element: Element | null, action: Action) => void;
  private onNarration?: (text: string) => void;
  private pausePromise: Promise<void> | null = null;
  private pauseResolve: (() => void) | null = null;

  constructor(options: ActionExecutorOptions) {
    this.speed = options.speed;
    this.onActionStart = options.onActionStart;
    this.onActionComplete = options.onActionComplete;
    this.onHighlight = options.onHighlight;
    this.onNarration = options.onNarration;
  }

  setSpeed(speed: 0.5 | 1 | 2): void {
    this.speed = speed;
  }

  pause(): void {
    if (!this.isPaused) {
      this.isPaused = true;
      this.pausePromise = new Promise(resolve => {
        this.pauseResolve = resolve;
      });
    }
  }

  resume(): void {
    if (this.isPaused && this.pauseResolve) {
      this.isPaused = false;
      this.pauseResolve();
      this.pausePromise = null;
      this.pauseResolve = null;
    }
  }

  cancel(): void {
    this.isCancelled = true;
    this.resume();
  }

  private async waitIfPaused(): Promise<boolean> {
    if (this.isCancelled) return false;
    if (this.pausePromise) {
      await this.pausePromise;
    }
    return !this.isCancelled;
  }

  private async executeNavigate(action: Action): Promise<ActionResult> {
    const url = action.value;
    if (!url) {
      return { success: false, action, error: "No URL provided", timestamp: new Date() };
    }

    this.onNarration?.(`Navigating to ${url}`);
    
    try {
      window.history.pushState({}, "", url);
      window.dispatchEvent(new PopStateEvent("popstate"));
      await sleep(getDelay(this.speed, 300));
      return { success: true, action, timestamp: new Date() };
    } catch (error) {
      return { success: false, action, error: String(error), timestamp: new Date() };
    }
  }

  private async executeClick(action: Action): Promise<ActionResult> {
    if (!action.target) {
      return { success: false, action, error: "No target specified", timestamp: new Date() };
    }

    const element = findElement(action.target);
    if (!element) {
      return { success: false, action, error: `Element not found: ${action.target}`, timestamp: new Date() };
    }

    this.onHighlight?.(element, action);
    this.onNarration?.(`Clicking ${action.description || action.target}`);

    scrollToElement(element);
    await sleep(getDelay(this.speed, 200));

    try {
      (element as HTMLElement).click();
      await sleep(getDelay(this.speed, 100));
      this.onHighlight?.(null, action);
      return { success: true, action, timestamp: new Date() };
    } catch (error) {
      this.onHighlight?.(null, action);
      return { success: false, action, error: String(error), timestamp: new Date() };
    }
  }

  private async executeFill(action: Action): Promise<ActionResult> {
    if (!action.target) {
      return { success: false, action, error: "No target specified", timestamp: new Date() };
    }

    const element = findElement(action.target);
    if (!element) {
      return { success: false, action, error: `Element not found: ${action.target}`, timestamp: new Date() };
    }

    if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) {
      return { success: false, action, error: "Target is not an input element", timestamp: new Date() };
    }

    this.onHighlight?.(element, action);
    this.onNarration?.(`Typing "${action.value}" into ${action.description || action.target}`);

    scrollToElement(element);
    await sleep(getDelay(this.speed, 200));

    try {
      element.focus();
      element.value = "";
      
      const value = action.value || "";
      const charDelay = Math.max(20, getDelay(this.speed, 50));
      
      for (const char of value) {
        if (this.isCancelled) break;
        element.value += char;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        await sleep(charDelay);
      }

      element.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(getDelay(this.speed, 100));
      this.onHighlight?.(null, action);
      return { success: true, action, timestamp: new Date() };
    } catch (error) {
      this.onHighlight?.(null, action);
      return { success: false, action, error: String(error), timestamp: new Date() };
    }
  }

  private async executeSelect(action: Action): Promise<ActionResult> {
    if (!action.target) {
      return { success: false, action, error: "No target specified", timestamp: new Date() };
    }

    const element = findElement(action.target);
    if (!element) {
      return { success: false, action, error: `Element not found: ${action.target}`, timestamp: new Date() };
    }

    if (!(element instanceof HTMLSelectElement)) {
      return { success: false, action, error: "Target is not a select element", timestamp: new Date() };
    }

    this.onHighlight?.(element, action);
    this.onNarration?.(`Selecting "${action.value}" from ${action.description || action.target}`);

    scrollToElement(element);
    await sleep(getDelay(this.speed, 200));

    try {
      element.focus();
      element.value = action.value || "";
      element.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(getDelay(this.speed, 100));
      this.onHighlight?.(null, action);
      return { success: true, action, timestamp: new Date() };
    } catch (error) {
      this.onHighlight?.(null, action);
      return { success: false, action, error: String(error), timestamp: new Date() };
    }
  }

  private async executeSubmit(action: Action): Promise<ActionResult> {
    if (!action.target) {
      return { success: false, action, error: "No target specified", timestamp: new Date() };
    }

    const element = findElement(action.target);
    if (!element) {
      return { success: false, action, error: `Element not found: ${action.target}`, timestamp: new Date() };
    }

    const form = element.closest("form") || (element instanceof HTMLFormElement ? element : null);
    if (!form) {
      return { success: false, action, error: "No form found", timestamp: new Date() };
    }

    this.onHighlight?.(form, action);
    this.onNarration?.(`Submitting form`);

    scrollToElement(form);
    await sleep(getDelay(this.speed, 200));

    try {
      form.requestSubmit();
      await sleep(getDelay(this.speed, 300));
      this.onHighlight?.(null, action);
      return { success: true, action, timestamp: new Date() };
    } catch (error) {
      this.onHighlight?.(null, action);
      return { success: false, action, error: String(error), timestamp: new Date() };
    }
  }

  private async executeScroll(action: Action): Promise<ActionResult> {
    this.onNarration?.(`Scrolling ${action.value || "page"}`);

    try {
      if (action.target) {
        const element = findElement(action.target);
        if (element) {
          scrollToElement(element);
        }
      } else if (action.value === "top") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else if (action.value === "bottom") {
        window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      } else {
        const amount = parseInt(action.value || "300", 10);
        window.scrollBy({ top: amount, behavior: "smooth" });
      }
      await sleep(getDelay(this.speed, 300));
      return { success: true, action, timestamp: new Date() };
    } catch (error) {
      return { success: false, action, error: String(error), timestamp: new Date() };
    }
  }

  private async executeHover(action: Action): Promise<ActionResult> {
    if (!action.target) {
      return { success: false, action, error: "No target specified", timestamp: new Date() };
    }

    const element = findElement(action.target);
    if (!element) {
      return { success: false, action, error: `Element not found: ${action.target}`, timestamp: new Date() };
    }

    this.onHighlight?.(element, action);
    this.onNarration?.(`Hovering over ${action.description || action.target}`);

    scrollToElement(element);
    await sleep(getDelay(this.speed, 200));

    try {
      element.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
      element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      await sleep(getDelay(this.speed, 500));
      this.onHighlight?.(null, action);
      return { success: true, action, timestamp: new Date() };
    } catch (error) {
      this.onHighlight?.(null, action);
      return { success: false, action, error: String(error), timestamp: new Date() };
    }
  }

  private async executeWait(action: Action): Promise<ActionResult> {
    const duration = parseInt(action.value || "1000", 10);
    this.onNarration?.(`Waiting ${duration}ms`);
    await sleep(duration);
    return { success: true, action, timestamp: new Date() };
  }

  private async executeHighlight(action: Action): Promise<ActionResult> {
    if (!action.target) {
      return { success: false, action, error: "No target specified", timestamp: new Date() };
    }

    const element = findElement(action.target);
    if (!element) {
      return { success: false, action, error: `Element not found: ${action.target}`, timestamp: new Date() };
    }

    this.onHighlight?.(element, action);
    this.onNarration?.(action.description || `Highlighting ${action.target}`);
    scrollToElement(element);
    
    const duration = parseInt(action.value || "2000", 10);
    await sleep(duration);
    
    this.onHighlight?.(null, action);
    return { success: true, action, timestamp: new Date() };
  }

  private async executeFocus(action: Action): Promise<ActionResult> {
    if (!action.target) {
      return { success: false, action, error: "No target specified", timestamp: new Date() };
    }

    const element = findElement(action.target);
    if (!element || !(element instanceof HTMLElement)) {
      return { success: false, action, error: `Element not found: ${action.target}`, timestamp: new Date() };
    }

    this.onHighlight?.(element, action);
    this.onNarration?.(`Focusing on ${action.description || action.target}`);

    scrollToElement(element);
    await sleep(getDelay(this.speed, 200));

    try {
      element.focus();
      await sleep(getDelay(this.speed, 100));
      this.onHighlight?.(null, action);
      return { success: true, action, timestamp: new Date() };
    } catch (error) {
      this.onHighlight?.(null, action);
      return { success: false, action, error: String(error), timestamp: new Date() };
    }
  }

  async executeAction(action: Action): Promise<ActionResult> {
    if (this.isCancelled) {
      return { success: false, action, error: "Execution cancelled", timestamp: new Date() };
    }

    if (!(await this.waitIfPaused())) {
      return { success: false, action, error: "Execution cancelled", timestamp: new Date() };
    }

    this.onActionStart?.(action);

    let result: ActionResult;

    switch (action.type) {
      case "navigate":
        result = await this.executeNavigate(action);
        break;
      case "click":
        result = await this.executeClick(action);
        break;
      case "fill":
        result = await this.executeFill(action);
        break;
      case "select":
        result = await this.executeSelect(action);
        break;
      case "submit":
        result = await this.executeSubmit(action);
        break;
      case "scroll":
        result = await this.executeScroll(action);
        break;
      case "hover":
        result = await this.executeHover(action);
        break;
      case "wait":
        result = await this.executeWait(action);
        break;
      case "highlight":
        result = await this.executeHighlight(action);
        break;
      case "focus":
        result = await this.executeFocus(action);
        break;
      default:
        result = { success: false, action, error: `Unknown action type: ${action.type}`, timestamp: new Date() };
    }

    this.onActionComplete?.(result);
    return result;
  }

  async executeActions(actions: Action[]): Promise<ActionResult[]> {
    this.isCancelled = false;
    const results: ActionResult[] = [];

    for (const action of actions) {
      if (this.isCancelled) break;
      
      const result = await this.executeAction(action);
      results.push(result);

      if (!result.success) {
        break;
      }

      if (action.delay) {
        await sleep(getDelay(this.speed, action.delay));
      }
    }

    return results;
  }

  reset(): void {
    this.isCancelled = false;
    this.isPaused = false;
    this.pausePromise = null;
    this.pauseResolve = null;
  }
}

export function parseActionString(actionStr: string): Action | null {
  const match = actionStr.match(/^(\w+)\s*\(([^)]*)\)$/);
  if (!match) return null;

  const [, type, argsStr] = match;
  const args = argsStr.split(",").map(a => a.trim().replace(/^["']|["']$/g, ""));

  const id = `action-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  switch (type.toLowerCase()) {
    case "navigate":
      return { id, type: "navigate", value: args[0] };
    case "click":
      return { id, type: "click", target: args[0], description: args[1] };
    case "fill":
      return { id, type: "fill", target: args[0], value: args[1], description: args[2] };
    case "select":
      return { id, type: "select", target: args[0], value: args[1], description: args[2] };
    case "submit":
      return { id, type: "submit", target: args[0] };
    case "scroll":
      return { id, type: "scroll", target: args[0], value: args[1] };
    case "hover":
      return { id, type: "hover", target: args[0], description: args[1] };
    case "wait":
      return { id, type: "wait", value: args[0] };
    case "highlight":
      return { id, type: "highlight", target: args[0], value: args[1], description: args[2] };
    case "focus":
      return { id, type: "focus", target: args[0], description: args[1] };
    default:
      return null;
  }
}

export function parseActionsFromText(text: string): Action[] {
  const actionPattern = /\b(navigate|click|fill|select|submit|scroll|hover|wait|highlight|focus)\s*\([^)]*\)/gi;
  const matches = text.match(actionPattern) || [];
  return matches.map(parseActionString).filter((a): a is Action => a !== null);
}
