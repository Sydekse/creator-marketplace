/**
 * Query-string normalisation, shared by every filtered GET endpoint.
 *
 * Extracted from `app/api/admin/audit-log/route.ts` on KAN-28, when creator
 * discovery became the second caller — the same trigger that produced
 * `lib/paging.ts` and `lib/money.ts`. Nothing here was audit-specific: it is the
 * gap between what a query string can say and what a zod schema accepts, and
 * every endpoint that renders its filters as a form has the same gap.
 *
 * A leaf module — it imports nothing, so a route handler, a Server Component or
 * a test can reach it without dragging drizzle or the schema along.
 */

/**
 * Reads a query string into schema keys.
 *
 * Takes `URLSearchParams` rather than a `URL` so that both callers can use it:
 * a route handler has `new URL(request.url).searchParams`, while a Server
 * Component's `searchParams` prop is a plain object with no URL anywhere near
 * it — see `searchParamsFrom`.
 *
 * Two things happen, both about the gap between what a query string can say and
 * what a zod schema accepts:
 *
 *   - **Empty means absent.** A UI that renders every filter as an input sends
 *     `?niche=&price_min=` when they are untouched; without this those empty
 *     strings reach the schema as values and fail the enum. On a GET form this
 *     is load-bearing rather than defensive — a form submits every field it
 *     renders, so the untouched case is the *common* one, not an edge.
 *   - **snake_case is folded to camelCase**, per the caller's `aliases`.
 *
 * `conflicts` carries any filter given under both spellings with *different*
 * values. That request has no correct answer — one of the two is going to be
 * ignored — and quietly picking a winner is the same class of bug as dropping
 * the key was. The same spelling repeated (`?limit=1&limit=2`) is not a
 * conflict: that is ordinary query-string duplication, and last-wins is what
 * every other reader of a URL does with it.
 *
 * `aliases` is a closed map supplied by the caller rather than a `_x -> X`
 * regex. A general rule would invent a plausible field name for anything
 * underscored, so a misspelling would arrive as a plausible-looking unknown key
 * instead of being rejected by the schema's `.strict()` — which is the whole
 * defence against a silently unfiltered response.
 */
export function readParams(
  search: URLSearchParams,
  aliases: Record<string, string> = {}
): { params: Record<string, string>; conflicts: string[] } {
  const params: Record<string, string> = {};
  const spelledAs = new Map<string, string>();
  const conflicts = new Set<string>();

  for (const [key, value] of search) {
    if (value === '') continue;

    const name = aliases[key] ?? key;
    const previous = spelledAs.get(name);
    if (previous !== undefined && previous !== key && params[name] !== value) {
      conflicts.add(name);
    }
    spelledAs.set(name, key);
    params[name] = value;
  }

  return { params, conflicts: [...conflicts] };
}

/**
 * A Server Component's `searchParams` prop, as `URLSearchParams`.
 *
 * Next hands pages a plain object, not a `URLSearchParams` instance, and spells
 * a repeated key as an array. Rebuilding the real thing means a page and a route
 * handler feed `readParams` the same shape, so `?niche=&price_min=` means the
 * same on both — rather than the page growing its own second reading of the
 * query string that agrees with the endpoint only until one of them changes.
 *
 * A repeated key contributes only its last value, which is what `readParams`
 * does with `?limit=1&limit=2` and what every other reader of a URL does.
 */
export function searchParamsFrom(
  record: Record<string, string | string[] | undefined>
): URLSearchParams {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    const last = Array.isArray(value) ? value[value.length - 1] : value;
    if (last !== undefined) search.set(key, last);
  }
  return search;
}

/**
 * The `details` map for a conflict, in the shape the error envelope wants.
 *
 * Lives here beside the detection rather than in each route, so two endpoints
 * cannot report the same condition with two different messages.
 */
export function conflictDetails(conflicts: string[]): Record<string, string[]> {
  return Object.fromEntries(
    conflicts.map((name) => [name, ['Given twice with different values.']])
  );
}
