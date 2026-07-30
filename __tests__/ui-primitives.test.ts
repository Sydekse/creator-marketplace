import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards against three Base UI misuses that all shipped in Wave 2 and were only
 * caught by opening the app in a browser.
 *
 * The component library here is shadcn/ui on **Base UI**, not Radix. The two
 * have near-identical component names and materially different APIs, so Radix
 * idioms type-check, render, and then fail at runtime. None of the three below
 * was caught by lint, typecheck or the build.
 *
 * These are source-level heuristics, not a substitute for rendering the
 * components. The repo has no DOM test environment (no jsdom, no Testing
 * Library) and adding one was out of scope for the auth ticket — a component
 * test harness is worth its own chore ticket, and the Playwright suites in
 * Waves 15-16 are where real interaction coverage belongs.
 */

const SOURCE_DIRS = ['app', 'components'];

function collectTsx(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectTsx(full);
    return entry.name.endsWith('.tsx') ? [full] : [];
  });
}

/**
 * Block comments are stripped so a guard cannot trip over prose *about* the
 * pattern it forbids — including the comments in these components explaining
 * exactly these three mistakes. Line comments are left alone on purpose: `//`
 * appears inside string literals here (SVG xmlns URLs), and removing those
 * would corrupt the code being scanned.
 */
const SOURCES: ReadonlyArray<{ file: string; src: string }> =
  SOURCE_DIRS.flatMap((dir) =>
    collectTsx(path.join(process.cwd(), dir)).map((file) => ({
      file: path.relative(process.cwd(), file),
      src: readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
    }))
  );

describe('Base UI usage', () => {
  it('finds source files to check', () => {
    // A refactor that moves these directories should fail loudly rather than
    // leave the suite silently asserting nothing.
    expect(SOURCES.length).toBeGreaterThan(10);
  });

  /**
   * A Base UI trigger/close renders its own `<button>`. Passing `<Button>` as a
   * child nests one button in another; the browser reparents it, so the server
   * HTML and the client tree disagree and hydration fails. The element is
   * replaced with `render={<Button … />}` instead.
   */
  it('never nests a <Button> inside a trigger or close element', () => {
    const offenders = SOURCES.filter(({ src }) =>
      // `[\w.]*` so the dotted primitive forms are covered too, not just the
      // re-exported wrappers: `<SheetPrimitive.Close>` as well as `<SheetClose>`.
      /<[\w.]*(?:Trigger|Close)\b[\s\S]*?>\s*<Button\b/.test(src)
    ).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  /**
   * Base UI's `Menu.GroupLabel` reads group context to wire `aria-labelledby`
   * and throws a runtime error without a `Menu.Group` ancestor. Radix's
   * equivalent works standalone, which is why this looked correct.
   *
   * Coarse by necessity: proper nesting analysis needs a JSX parser. A file
   * using the label must at least also use a group.
   */
  it('never uses a menu label without a menu group', () => {
    const offenders = SOURCES.filter(
      ({ src }) =>
        src.includes('<DropdownMenuLabel') &&
        !/<DropdownMenu(?:Group|RadioGroup)\b/.test(src)
    ).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  /**
   * Base UI menu items expose `onClick`. `onSelect` is the Radix name, and it is
   * also a real React DOM event — the text-selection one — so React binds it
   * without complaint and the handler never runs on a click. A menu item wired
   * that way is silently inert, which is how sign-out shipped broken.
   */
  it('never wires a menu item with onSelect', () => {
    const offenders = SOURCES.filter(({ src }) => /onSelect\s*=/.test(src)).map(
      ({ file }) => file
    );
    expect(offenders).toEqual([]);
  });
});
