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
      // Normalize Windows separators so source guards behave identically on
      // Windows and POSIX runners.
      file: path.relative(process.cwd(), file).replaceAll(path.sep, '/'),
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
      //
      // `[^<]*` — not `[\s\S]*?` — bounds the match to the trigger's *own*
      // opening tag. The lazy any-character form looked equivalent but scans
      // for the nearest `>` that happens to be followed by `<Button`, and `>`
      // ends every intervening tag too. So a file with `<SelectTrigger>` near
      // the top and an unrelated submit `<Button>` 120 lines below matched,
      // reporting a hydration bug that was not there. Excluding `<` stops the
      // match at the first nested element, which is the actual rule: a
      // *direct* `<Button>` child. `>` stays allowed inside the tag so arrow
      // functions in attributes (`onClick={() => …}`) still parse.
      /<[\w.]*(?:Trigger|Close)\b[^<]*>\s*<Button\b/.test(src)
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

  /**
   * A fourth of the same kind, found the same way — by opening the page.
   *
   * `<Button render={<Link/>}>` renders an `<a>` while `nativeButton` still
   * defaults to `true`, which Base UI warns about at runtime. Setting it
   * `false` silences the warning and is still wrong: `useButton` then applies
   * `role="button"` to the anchor, so a link announces as a button and loses
   * the affordances that go with being one.
   *
   * A link that looks like a button is styling, not behaviour. `buttonVariants`
   * is exported for it, and keeps a real `<a>` — middle-clickable, openable in
   * a new tab, announced as a link.
   */
  it('never renders a Button as a Link', () => {
    const offenders = SOURCES.filter(({ src }) =>
      // Bounded to the Button's own opening tag by `[^<]*`, for the reason
      // spelled out in the trigger guard above.
      /<Button\b[^<]*render=\{<Link\b/.test(src)
    ).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

/**
 * KAN-200 item 9: "buttons don't highlight well".
 *
 * Same species as the four guards above — found by opening the app, invisible to
 * lint, typecheck and the build. Two specific gaps:
 *
 *   - `outline` changed only its border and text colour on hover, which is a
 *     one-pixel difference on a white card.
 *   - the only pressed treatment anywhere was `active:scale-[0.98]` in the base
 *     string. A transform is a poor press indicator on a touch device: there is
 *     no hover state to have preceded it, and the finger is covering the control
 *     that shrinks.
 *
 * These read the variant strings rather than a rendered element, so they prove
 * the classes are *present*, never that they are visible. That is the standing
 * limitation of this whole file.
 */
describe('button variants', () => {
  const BUTTON = 'components/ui/button.tsx';
  const source = SOURCES.find(({ file }) => file === BUTTON);

  /** The `variant: { … }` block, so a stray `active:` elsewhere cannot satisfy these. */
  const variantBlock = (source?.src ?? '').slice(
    (source?.src ?? '').indexOf('variant: {'),
    (source?.src ?? '').indexOf('size: {')
  );

  it('finds the variant block', () => {
    // A rename or a move should fail loudly rather than leave the two guards
    // below asserting against an empty string.
    expect(source).toBeDefined();
    expect(variantBlock).toContain('outline');
    expect(variantBlock.length).toBeGreaterThan(200);
  });

  /**
   * Every variant, not just the ones that looked wrong. A press with no colour
   * change is the reported bug, and the variant that lacks one is the variant
   * whoever styles the next screen will reach for.
   */
  it.each(['default', 'outline', 'secondary', 'ghost', 'destructive', 'link'])(
    'gives %s a pressed treatment that is not only a transform',
    (variant) => {
      // Each variant's own string: from its key to the next `:` that starts a
      // property, bounded so `default`'s classes cannot vouch for `outline`'s.
      const start = variantBlock.indexOf(`${variant}:`);
      expect(start).toBeGreaterThan(-1);
      const declaration = variantBlock.slice(
        start,
        variantBlock.indexOf("',", start)
      );
      // `bg-`, `text-` or `underline`: `link` is the one variant with no
      // background to darken, so it deepens its colour instead. What none of them
      // may do is rely on the base string's scale alone, which is the bug.
      expect(declaration).toMatch(/active:(?:bg-|text-|underline)/);
    }
  );

  it('gives outline a hover background, not just a border', () => {
    // The reported symptom. `ghost` is the reference: `hover:bg-muted`.
    const start = variantBlock.indexOf('outline:');
    const declaration = variantBlock.slice(
      start,
      variantBlock.indexOf("',", start)
    );
    expect(declaration).toMatch(/hover:bg-/);
  });

  it('keeps the treatments that were already right', () => {
    // Additive, per the ticket: nothing that already looked correct changes. The
    // shine, the focus ring and the scale are all still there.
    expect(source?.src).toContain('btn-shine');
    expect(source?.src).toContain('focus-visible:ring-ring/50');
    expect(source?.src).toContain('active:not-aria-[haspopup]:scale-[0.98]');
  });
});
