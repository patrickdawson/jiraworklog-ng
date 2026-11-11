// A small Playwright-style locator layer over WebdriverIO, so the ported specs
// keep the shape and the assertions of the Playwright originals
// (tests/e2e/*.spec.ts).
//
// - Locators are lazy step lists, resolved in the page in one round trip.
// - Matching follows Playwright: a string name/text/label matches as a
//   case-insensitive substring after whitespace normalisation (`exact: true`
//   for equality), a RegExp is tested as is. Role queries skip elements that
//   are hidden from the accessibility tree. Accessible names are computed by a
//   simplified version of the ARIA algorithm that covers what this app uses.
// - Actions are strict (exactly one match) and retry until the element is
//   there and visible; assertions poll until they hold or time out (10 s).
// - Clicks, typing and the wheel are real WebDriver input, not synthetic DOM
//   events.
import { browser } from "@wdio/globals";
import { expect as jestExpect } from "expect";
import { readFileSync, statSync } from "node:fs";
import { Key } from "webdriverio";
import { APP_LOG_PATH, APP_ORIGIN } from "./paths.ts";

const TIMEOUT = 10_000;
const POLL = 100;

type Matcher = string | RegExp;
type WireMatcher = { s: string } | { re: string; flags: string };

const wire = (m: Matcher): WireMatcher =>
  typeof m === "string" ? { s: m } : { re: m.source, flags: m.flags };

type Step =
  | { kind: "css"; css: string }
  | { kind: "role"; role: string; name?: WireMatcher; exact?: boolean; level?: number }
  | { kind: "text"; m: WireMatcher; exact?: boolean }
  | { kind: "label"; m: WireMatcher; exact?: boolean }
  | { kind: "placeholder"; m: WireMatcher }
  | { kind: "title"; m: WireMatcher }
  | { kind: "hasText"; m: WireMatcher }
  | { kind: "nth"; i: number };

type Inspect = {
  visible: boolean;
  text: string;
  value: string | null;
  checked: boolean | null;
  focused: boolean;
  inViewport: boolean;
  attr: string | null;
  css: string | null;
};

// In-page code. A plain string, so the TypeScript loader cannot inject
// helpers into it. `arguments[0]` = steps, `arguments[1]` = what to return.
const RESOLVE = String.raw`
const steps = arguments[0];
const want = arguments[1];
const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
function test(text, m, exact) {
  text = norm(text);
  if (m.re !== undefined) return new RegExp(m.re, m.flags).test(text);
  const s = norm(m.s);
  return exact ? text === s : text.toLowerCase().includes(s.toLowerCase());
}
const INLINE = new Set(["inline", "inline-block", "inline-flex", "inline-grid", "contents"]);
function subtreeText(node) {
  let out = "";
  for (const c of node.childNodes) {
    if (c.nodeType === 3) { out += c.textContent; continue; }
    if (c.nodeType !== 1) continue;
    const tag = c.tagName.toLowerCase();
    if (["script", "style", "title", "select", "textarea", "input", "template"].includes(tag)) continue;
    if (c.getAttribute("aria-hidden") === "true") continue;
    const st = getComputedStyle(c);
    if (st.display === "none" || st.visibility === "hidden") continue;
    const pad = INLINE.has(st.display) ? "" : " ";
    const label = c.getAttribute("aria-label");
    out += pad + (label && label.trim() ? label : subtreeText(c)) + pad;
  }
  return out;
}
function implicitRole(el) {
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case "a": return el.hasAttribute("href") ? "link" : "";
    case "button": return "button";
    case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": return "heading";
    case "dialog": return "dialog";
    case "select": return el.multiple || el.size > 1 ? "listbox" : "combobox";
    case "textarea": return "textbox";
    case "option": return "option";
    case "ul": case "ol": return "list";
    case "li": return "listitem";
    case "nav": return "navigation";
    case "main": return "main";
    case "table": return "table";
    case "img": return el.getAttribute("alt") === "" ? "presentation" : "img";
    case "section": return el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby") ? "region" : "";
    case "input": {
      const t = (el.getAttribute("type") || "text").toLowerCase();
      if (t === "checkbox") return "checkbox";
      if (t === "radio") return "radio";
      if (["button", "submit", "reset", "image"].includes(t)) return "button";
      if (t === "number") return "spinbutton";
      if (t === "range") return "slider";
      if (["text", "email", "url", "search", "tel", "password"].includes(t)) return el.hasAttribute("list") ? "combobox" : "textbox";
      return "";
    }
  }
  return "";
}
function roleOf(el) {
  const explicit = (el.getAttribute("role") || "").trim().split(/\s+/)[0];
  return explicit || implicitRole(el);
}
const FROM_CONTENT = new Set(["button", "link", "heading", "option", "menuitem", "menuitemradio",
  "menuitemcheckbox", "tab", "cell", "columnheader", "rowheader", "checkbox", "radio", "switch",
  "tooltip", "treeitem", "row", "listitem"]);
function labelledBy(el) {
  const ids = el.getAttribute("aria-labelledby");
  if (!ids) return "";
  return norm(ids.split(/\s+/).map((id) => {
    const r = document.getElementById(id);
    return r ? (r.getAttribute("aria-label") || subtreeText(r)) : "";
  }).join(" "));
}
function controlLabel(el) {
  const lb = labelledBy(el);
  if (lb) return lb;
  const al = el.getAttribute("aria-label");
  if (al && al.trim()) return norm(al);
  if (el.labels && el.labels.length) return norm(Array.from(el.labels).map(subtreeText).join(" "));
  return "";
}
function accName(el) {
  const ctl = controlLabel(el);
  if (ctl) return ctl;
  const tag = el.tagName.toLowerCase();
  if (tag === "input") {
    const t = (el.getAttribute("type") || "text").toLowerCase();
    if (["button", "submit", "reset"].includes(t)) return norm(el.value);
  }
  if (tag === "input" || tag === "select" || tag === "textarea")
    return norm(el.getAttribute("title") || el.getAttribute("placeholder") || "");
  if (FROM_CONTENT.has(roleOf(el))) {
    const t = norm(subtreeText(el));
    if (t) return t;
  }
  return norm(el.getAttribute("title") || "");
}
function a11yHidden(el) {
  if (el.closest('[aria-hidden="true"]')) return true;
  return !el.checkVisibility({ visibilityProperty: true });
}
function visible(el) {
  if (!el.isConnected) return false;
  if (!el.checkVisibility({ visibilityProperty: true })) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}
function descendants(roots, sel) {
  const out = [];
  for (const r of roots) for (const e of r.querySelectorAll(sel)) out.push(e);
  return Array.from(new Set(out));
}
let set = [document];
for (const st of steps) {
  if (st.kind === "css") set = descendants(set, st.css);
  else if (st.kind === "role") {
    set = descendants(set, "*").filter((e) => {
      if (roleOf(e) !== st.role || a11yHidden(e)) return false;
      if (st.level !== undefined) {
        const lvl = Number(e.getAttribute("aria-level") || e.tagName.slice(1));
        if (lvl !== st.level) return false;
      }
      return !st.name || test(accName(e), st.name, st.exact);
    });
  } else if (st.kind === "text") {
    const hits = descendants(set, "*").filter((e) => {
      const tag = e.tagName.toLowerCase();
      if (["script", "style", "head", "template", "html"].includes(tag)) return false;
      return test(e.textContent, st.m, st.exact);
    });
    const hitSet = new Set(hits);
    set = hits.filter((e) => !Array.from(e.querySelectorAll("*")).some((d) => hitSet.has(d)));
  } else if (st.kind === "label") {
    set = descendants(set, "input, select, textarea, [aria-label], [aria-labelledby]")
      .filter((e) => test(controlLabel(e), st.m, st.exact));
  } else if (st.kind === "placeholder") {
    set = descendants(set, "[placeholder]").filter((e) => test(e.getAttribute("placeholder"), st.m));
  } else if (st.kind === "title") {
    set = descendants(set, "[title]").filter((e) => test(e.getAttribute("title"), st.m));
  } else if (st.kind === "hasText") {
    set = set.filter((e) => test(e.textContent, st.m));
  } else if (st.kind === "nth") {
    const i = st.i < 0 ? set.length + st.i : st.i;
    set = set[i] ? [set[i]] : [];
  }
}
if (!want) return set;
return set.map((e) => {
  const r = e.getBoundingClientRect();
  return {
    visible: visible(e),
    text: norm(e.textContent),
    value: "value" in e && typeof e.value === "string" ? e.value : null,
    checked: "checked" in e ? !!e.checked : null,
    focused: document.activeElement === e,
    inViewport: r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 &&
      r.top < window.innerHeight && r.left < window.innerWidth,
    attr: want.attr ? e.getAttribute(want.attr) : null,
    css: want.css ? getComputedStyle(e).getPropertyValue(want.css) : null,
  };
});
`;

function describeMatcher(m: WireMatcher | undefined): string {
  if (!m) return "";
  return "re" in m ? `/${m.re}/${m.flags}` : JSON.stringify(m.s);
}

export class Loc {
  constructor(readonly steps: Step[]) {}

  toString(): string {
    return this.steps
      .map((s) => {
        switch (s.kind) {
          case "css": return `locator(${JSON.stringify(s.css)})`;
          case "role": return `getByRole(${s.role}${s.name ? `, ${describeMatcher(s.name)}` : ""})`;
          case "text": case "label": case "placeholder": case "title": case "hasText":
            return `${s.kind}(${describeMatcher(s.m)})`;
          case "nth": return `nth(${s.i})`;
        }
      })
      .join(".");
  }

  private with(step: Step): Loc {
    return new Loc([...this.steps, step]);
  }

  // ── Queries ──────────────────────────────────────────────────────────────
  locator(css: string): Loc { return this.with({ kind: "css", css }); }
  getByTestId(id: string): Loc { return this.locator(`[data-testid="${id}"]`); }
  getByRole(role: string, opts: { name?: Matcher; exact?: boolean; level?: number } = {}): Loc {
    return this.with({
      kind: "role", role,
      name: opts.name === undefined ? undefined : wire(opts.name),
      exact: opts.exact, level: opts.level,
    });
  }
  getByText(m: Matcher, opts: { exact?: boolean } = {}): Loc {
    return this.with({ kind: "text", m: wire(m), exact: opts.exact });
  }
  getByLabel(m: Matcher, opts: { exact?: boolean } = {}): Loc {
    return this.with({ kind: "label", m: wire(m), exact: opts.exact });
  }
  getByPlaceholder(m: Matcher): Loc { return this.with({ kind: "placeholder", m: wire(m) }); }
  getByTitle(m: Matcher): Loc { return this.with({ kind: "title", m: wire(m) }); }
  filter(opts: { hasText: Matcher }): Loc { return this.with({ kind: "hasText", m: wire(opts.hasText) }); }
  nth(i: number): Loc { return this.with({ kind: "nth", i }); }
  first(): Loc { return this.nth(0); }
  last(): Loc { return this.nth(-1); }

  // ── Resolution ───────────────────────────────────────────────────────────
  async elements(): Promise<WebdriverIO.Element[]> {
    // execute() answers with raw W3C element references; $() wraps them.
    const found = ((await browser.execute(RESOLVE, this.steps, null)) ?? []) as unknown[];
    return Promise.all(
      found.map((ref) => browser.$(ref as Parameters<typeof browser.$>[0]).getElement()),
    );
  }

  async inspect(want: { attr?: string; css?: string } = {}): Promise<Inspect[]> {
    return (await browser.execute(RESOLVE, this.steps, want)) as unknown as Inspect[];
  }

  async count(): Promise<number> {
    return (await this.inspect()).length;
  }

  async all(): Promise<Loc[]> {
    const n = await this.count();
    return Array.from({ length: n }, (_, i) => this.nth(i));
  }

  /** The one matching element, waiting until it exists and is visible. */
  private async one(action: string): Promise<WebdriverIO.Element> {
    let last = "";
    const deadline = Date.now() + TIMEOUT;
    for (;;) {
      const info = await this.inspect();
      if (info.length === 1 && info[0].visible) return (await this.elements())[0];
      last = info.length === 1 ? "not visible" : `${info.length} matches`;
      if (Date.now() > deadline) throw new Error(`${action} ${this}: ${last}`);
      await sleep(POLL);
    }
  }

  private async retry<T>(action: string, fn: (el: WebdriverIO.Element) => Promise<T>): Promise<T> {
    const deadline = Date.now() + TIMEOUT;
    for (;;) {
      const el = await this.one(action);
      try {
        return await fn(el);
      } catch (err) {
        // Stale element, or the click was intercepted (an overlay still
        // fading out): Playwright waits for actionability, so do we.
        if (Date.now() > deadline) throw err;
        await sleep(POLL);
      }
    }
  }

  // ── Actions ──────────────────────────────────────────────────────────────
  async click(): Promise<void> {
    await this.retry("click", (el) => el.click());
  }

  async focus(): Promise<void> {
    await this.retry("focus", (el) => browser.execute(FOCUS, el));
  }

  /** Replaces the value, as Playwright's `fill`. */
  async fill(value: string): Promise<void> {
    await this.retry("fill", async (el) => {
      const type = (await el.getAttribute("type")) ?? "";
      if (["date", "time", "datetime-local", "month", "week", "color", "range"].includes(type)) {
        // These have no free text to type into; Playwright sets them directly too.
        await browser.execute(SET_VALUE, el, value);
        return;
      }
      await browser.execute(FOCUS, el);
      await browser.keys([Key.Ctrl, "a"]);
      await browser.keys(Key.Backspace);
      if (value) await browser.keys(value);
    });
  }

  /** Focuses the element and presses one key. */
  async press(key: keyof typeof KEYS): Promise<void> {
    await this.focus();
    await browser.keys(KEYS[key]);
  }

  async check(): Promise<void> { await this.setChecked(true); }
  async uncheck(): Promise<void> { await this.setChecked(false); }

  private async setChecked(on: boolean): Promise<void> {
    const [info] = await this.inspect();
    if (info?.checked !== on) await this.click();
    await expect(this).toBeChecked({ checked: on });
  }

  async textContent(): Promise<string> {
    await this.one("textContent");
    return (await this.inspect())[0].text;
  }

  async inputValue(): Promise<string> {
    await this.one("inputValue");
    return (await this.inspect())[0].value ?? "";
  }

  async boundingBox(): Promise<{ x: number; y: number; width: number; height: number }> {
    const el = await this.one("boundingBox");
    return (await browser.execute(
      "const r = arguments[0].getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };",
      el,
    )) as { x: number; y: number; width: number; height: number };
  }

  /** Runs `fn` on the element in the page. `fn` must not close over anything. */
  async evaluate<T>(fn: (el: HTMLElement) => T): Promise<T> {
    const el = await this.one("evaluate");
    return (await browser.execute(
      `return (${fn.toString()})(arguments[0]);`,
      el,
    )) as T;
  }
}

const FOCUS = "arguments[0].focus();";

const SET_VALUE = String.raw`
const el = arguments[0], value = arguments[1];
el.focus();
const proto = Object.getPrototypeOf(el);
Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
el.dispatchEvent(new Event("input", { bubbles: true }));
el.dispatchEvent(new Event("change", { bubbles: true }));
`;

const KEYS = {
  Enter: Key.Enter,
  Escape: Key.Escape,
  ArrowDown: Key.ArrowDown,
  ArrowUp: Key.ArrowUp,
  Tab: Key.Tab,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Assertions ───────────────────────────────────────────────────────────────

async function pollUntil(
  describe: () => string,
  check: () => Promise<boolean>,
  timeout = TIMEOUT,
): Promise<void> {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error(`Timed out after ${timeout} ms: ${describe()}`);
    await sleep(POLL);
  }
}

const normText = (s: string) => s.replace(/\s+/g, " ").trim();
const fullMatch = (actual: string, m: Matcher) =>
  typeof m === "string" ? normText(actual) === normText(m) : m.test(actual);
const containsMatch = (actual: string, m: Matcher) =>
  typeof m === "string" ? normText(actual).includes(normText(m)) : m.test(actual);

class LocAssertions {
  constructor(private loc: Loc, private negate = false) {}

  get not(): LocAssertions {
    return new LocAssertions(this.loc, !this.negate);
  }

  private async poll(
    what: string,
    want: { attr?: string; css?: string },
    ok: (els: Inspect[]) => boolean,
    timeout?: number,
  ): Promise<void> {
    let last: Inspect[] = [];
    await pollUntil(
      () => `expect(${this.loc})${this.negate ? ".not" : ""}.${what}; got ${JSON.stringify(last)}`,
      async () => {
        last = await this.loc.inspect(want);
        return ok(last) !== this.negate;
      },
      timeout,
    );
  }

  /** Strict, as in Playwright: exactly one element, and it is visible. */
  toBeVisible(): Promise<void> {
    return this.poll("toBeVisible()", {}, (e) => e.length === 1 && e[0].visible);
  }

  toBeHidden(): Promise<void> {
    return this.poll("toBeHidden()", {}, (e) => e.every((x) => !x.visible));
  }

  toHaveCount(n: number): Promise<void> {
    return this.poll(`toHaveCount(${n})`, {}, (e) => e.length === n);
  }

  toHaveText(m: Matcher | Matcher[]): Promise<void> {
    if (Array.isArray(m)) {
      return this.poll(`toHaveText(${m})`, {}, (e) =>
        e.length === m.length && e.every((x, i) => fullMatch(x.text, m[i])),
      );
    }
    return this.poll(`toHaveText(${m})`, {}, (e) => e.length === 1 && fullMatch(e[0].text, m));
  }

  toContainText(m: Matcher): Promise<void> {
    return this.poll(`toContainText(${m})`, {}, (e) => e.length === 1 && containsMatch(e[0].text, m));
  }

  toHaveValue(v: string): Promise<void> {
    return this.poll(`toHaveValue(${v})`, {}, (e) => e.length === 1 && e[0].value === v);
  }

  toHaveAttribute(name: string, m: Matcher): Promise<void> {
    return this.poll(`toHaveAttribute(${name}, ${m})`, { attr: name }, (e) =>
      e.length === 1 && e[0].attr !== null && fullMatch(e[0].attr, m),
    );
  }

  toHaveCSS(prop: string, m: Matcher): Promise<void> {
    return this.poll(`toHaveCSS(${prop}, ${m})`, { css: prop }, (e) =>
      e.length === 1 && e[0].css !== null && fullMatch(e[0].css, m),
    );
  }

  toBeChecked(opts: { checked?: boolean } = {}): Promise<void> {
    const want = opts.checked ?? true;
    return this.poll(`toBeChecked(${want})`, {}, (e) => e.length === 1 && e[0].checked === want);
  }

  toBeFocused(): Promise<void> {
    return this.poll("toBeFocused()", {}, (e) => e.length === 1 && e[0].focused);
  }

  toBeInViewport(): Promise<void> {
    return this.poll("toBeInViewport()", {}, (e) => e.length === 1 && e[0].inViewport);
  }
}

class UrlAssertions {
  async toHaveURL(re: RegExp): Promise<void> {
    let last = "";
    await pollUntil(
      () => `expect(page).toHaveURL(${re}); got ${last}`,
      async () => {
        last = await browser.getUrl();
        return re.test(last);
      },
    );
  }
}

type JestExpect = typeof jestExpect;

function expectImpl(actual: Page): UrlAssertions;
function expectImpl(actual: Loc): LocAssertions;
function expectImpl<T>(actual: T, message?: string): ReturnType<JestExpect>;
function expectImpl(actual: unknown, message?: string): unknown {
  if (actual === page) return new UrlAssertions();
  if (actual instanceof Loc) return new LocAssertions(actual);
  if (message) {
    // jest's expect has no message argument; keep it in the failure.
    const inner = jestExpect(actual);
    return new Proxy(inner, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv);
        if (typeof v !== "function") return v;
        return (...args: unknown[]) => {
          try {
            return v.apply(target, args);
          } catch (e) {
            (e as Error).message = `${message}\n${(e as Error).message}`;
            throw e;
          }
        };
      },
    });
  }
  return jestExpect(actual);
}

/** Polls `fn` until the matcher passes, like Playwright's `expect.poll`. */
function poll<T>(fn: () => Promise<T>, opts: { timeout?: number } = {}) {
  const run = async (assert: (v: T) => void) => {
    let lastErr: unknown;
    const deadline = Date.now() + (opts.timeout ?? TIMEOUT);
    for (;;) {
      try {
        assert(await fn());
        return;
      } catch (e) {
        lastErr = e;
      }
      if (Date.now() > deadline) throw lastErr;
      await sleep(POLL);
    }
  };
  return {
    toBe: (v: T) => run((x) => jestExpect(x).toBe(v)),
    toEqual: (v: unknown) => run((x) => jestExpect(x).toEqual(v)),
    toBeGreaterThan: (v: number) => run((x) => jestExpect(x).toBeGreaterThan(v)),
    toBeLessThan: (v: number) => run((x) => jestExpect(x).toBeLessThan(v)),
  };
}

export const expect = Object.assign(expectImpl, {
  poll,
  objectContaining: jestExpect.objectContaining,
});

// ── The page ────────────────────────────────────────────────────────────────

let navigation = 0;

class Page extends Loc {
  constructor() {
    super([]);
  }

  /**
   * Loads a route of the app afresh, like Playwright's `page.goto`. Routes are
   * hash routes; the changing query makes every call a full load, so seeded
   * data is read again (a hash change alone would keep the page).
   */
  async goto(route: string): Promise<void> {
    navigation += 1;
    await browser.url(`${APP_ORIGIN}/?nav=${navigation}#${route}`);
  }

  async reload(): Promise<void> {
    await browser.refresh();
  }

  async waitForTimeout(ms: number): Promise<void> {
    await sleep(ms);
  }

  async viewportSize(): Promise<{ width: number; height: number }> {
    return (await browser.execute(
      "return { width: window.innerWidth, height: window.innerHeight };",
    )) as { width: number; height: number };
  }

  /** WebView2 sizes the web view to the WebDriver window size. */
  async setViewportSize(size: { width: number; height: number }): Promise<void> {
    await browser.setWindowSize(size.width, size.height);
    await pollUntil(
      () => `viewport ${size.width}×${size.height}`,
      async () => {
        const v = await this.viewportSize();
        return v.width === size.width && v.height === size.height;
      },
    );
  }

  /** Mouse wheel over the centre of `target`, optionally with Ctrl held. */
  async wheel(target: Loc, deltaY: number, opts: { ctrl?: boolean } = {}): Promise<void> {
    const box = await target.boundingBox();
    const x = Math.round(box.x + box.width / 2);
    const y = Math.round(box.y + box.height / 2);
    const wheel = browser
      .action("wheel")
      .pause(1)
      .scroll({ x, y, deltaX: 0, deltaY, duration: 0 })
      .pause(1);
    if (!opts.ctrl) {
      await wheel.perform();
      return;
    }
    const keys = browser.action("key").down(Key.Ctrl).pause(1).pause(1).up(Key.Ctrl);
    await browser.actions([keys, wheel]);
  }

  /**
   * Emits a Tauri event from the web view, as the Rust side would (e.g. the
   * power watcher's `away-ended`). Listeners in the page receive it.
   */
  async emitEvent(event: string, payload: unknown): Promise<void> {
    await browser.execute(
      String.raw`return window.__TAURI_INTERNALS__.invoke("plugin:event|emit", { event: arguments[0], payload: arguments[1] });`,
      event,
      payload,
    );
  }

  /**
   * Moves the UI clock forward (fake clock of the `e2e` build, see
   * src-tauri/src/e2e.rs), like Playwright's `clock.fastForward`.
   */
  async fastForward(ms: number): Promise<void> {
    await browser.execute(
      String.raw`window.__jwlE2eClockOffsetMs = (Number(window.__jwlE2eClockOffsetMs) || 0) + arguments[0];`,
      ms,
    );
  }

  /**
   * Console errors and uncaught page errors since the returned mark. The app
   * forwards them to its log (ui/src/lib/log.ts), so this reads that file.
   */
  consoleMark(): number {
    try {
      return statSync(APP_LOG_PATH).size;
    } catch {
      return 0;
    }
  }

  async consoleErrorsSince(mark: number): Promise<string[]> {
    // The log plugin writes asynchronously.
    await sleep(500);
    let text = "";
    try {
      text = readFileSync(APP_LOG_PATH).subarray(mark).toString("utf8");
    } catch {
      return [];
    }
    return text
      .split(/\r?\n(?=\[\d{4}-\d{2}-\d{2}\])/)
      .filter((line) => /\]\[ERROR\]\[/.test(line));
  }
}

export const page = new Page();
