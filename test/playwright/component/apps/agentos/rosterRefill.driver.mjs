/**
 * @summary A test-only writer driver for the mounted roster seam: loaded INTO the App worker through
 * `Neo.worker.App.loadModule`, it performs one store mutation named by its module URL — the exact
 * writer shapes the cockpit uses (an admission's `clear()` then `add()`; an instance switch's
 * retirement `clear()` — nothing is seeded, so nothing reloads — followed by the next admission's
 * `clear()` then `add()`), which no remote of the App worker exposes. Every distinct URL executes
 * once (module cache), so a spec varies the `t` parameter per call.
 *
 * `?store=<id>&op=clearAdd&rows=<JSON>&t=<n>` · `?store=<id>&op=switchAdd&rows=<JSON>&t=<n>`
 */
const
    params = new URL(import.meta.url).searchParams,
    store  = Neo.get(params.get('store')),
    op     = params.get('op');

if (!store) {
    throw new Error(`rosterRefill.driver: no store registered as "${params.get('store')}"`)
}

if (op === 'clearAdd') {
    store.clear();
    store.add(JSON.parse(params.get('rows')))
} else if (op === 'switchAdd') {
    store.clear();
    store.clear();
    store.add(JSON.parse(params.get('rows')))
} else {
    throw new Error(`rosterRefill.driver: unknown op "${op}"`)
}

export default {op, count: store.getCount()};
