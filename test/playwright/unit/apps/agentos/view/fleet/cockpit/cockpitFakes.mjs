import path            from 'path';
import {fileURLToPath} from 'url';

/**
 * @summary The cockpit container specs' shared fakes — the provider, controller and activity-store
 * collaborators plus the roster seed path — one module the concern-named specs import by name, so
 * each carries only the seams it drives. Moved verbatim from the former `container.spec.mjs`
 * catch-all (#97); the fakes' own JSDoc travels with them.
 */
export const seedPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../../../apps/agentos/resources/data/fleetRoster.json');

// A usable three-source collection: the runtime axis is WIRED. The eligibility partition fails a
// fleet start closed without it (projected 'off' over unusable provenance is display fallback,
// never a stopped runtime), so every fixture that models a startable member carries this shape.
export const wiredSources = () => ({
    roster    : {source: 'fleet:listAgents',    state: 'wired', confidence: 'observed'},
    repoStatus: {source: 'fleet:fleetStatus',   state: 'wired', confidence: 'observed'},
    runtime   : {source: 'fleet:runtimeStatus', state: 'wired', confidence: 'observed'}
});

/**
 * Provider-owned activity collaborators for prototype-host tests. The Store records every admitted
 * bounded page; the provider records count truth. Keeping them separate pins the production boundary.
 */
export const makeActivityStoreHarness = () => {
    const activityStore = {
              pages: [],
              ingestSnapshot(events, options) {
                  this.pages.push({events, options});
                  return {added: events.length, dropped: 0, retained: events.length, newEventIds: events.map(event => event.eventId)}
              }
          },
          activityProvider = makeProviderFake();

    return {
        activityProvider,
        activityStore,
        activityWired                  : false,
        resolveFleetActivityEventsStore: () => activityStore
    }
};

/**
 * The provider fake mirrors `state.Provider`'s write surface (both `setData` forms) and seeds the
 * REAL config defaults — the load guards read `streamAdapterState`/`gridAdapterState`, so a fake
 * missing the 'sample' seed would let a pre-wired throw claim last-known data that never existed.
 */
export const makeProviderFake = (data = {}) => ({
    data: {
        daemonDegradedReason: null, daemonState: null,
        gridAdapterState: 'sample', gridDegradedReason: null, shellTransport: null,
        streamAdapterState: 'sample', streamDegradedReason: null, ...data
    },
    getData(key) { return this.data[key] },
    getStore() { return null },
    setData(key, value) {
        if (typeof key === 'object') { Object.assign(this.data, key) } else { this.data[key] = value }
    }
});

/**
 * Wires the REAL `detailRecord` reactive semantics onto a plain view fake: assignment runs the
 * class's afterSetDetailRecord hook (the pane push), exactly like the config system does on a
 * real instance. Returns the fake for chaining.
 */
export const wireDetailRecord = (view, ViewClass) => {
    let record = view.detailRecord ?? null;

    Object.defineProperty(view, 'detailRecord', {
        configurable: true,
        get() { return record },
        set(value) {
            const oldValue = record;
            record = value;
            ViewClass.prototype.afterSetDetailRecord.call(view, value, oldValue)
        }
    });

    return view
};

/**
 * A prototype-host controller fake: `Object.create` inherits every REAL method (the `bridge`
 * getter included — production code, no stub drift); the overrides pin only the seams the case
 * under test owns. `component` carries the configs the controller reads from its view.
 */
export const makeControllerFake = (Controller, overrides = {}) => Object.assign(Object.create(Controller.prototype), {
    activityWired       : false,
    component           : null,
    gridReadGeneration  : 0,
    gridReadInFlight    : 0,
    isDestroyed         : false,
    rosterWired         : false,
    streamReadGeneration: 0,
    streamReadInFlight  : 0,
    ...overrides
});
