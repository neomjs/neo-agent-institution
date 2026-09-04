import FleetActivityEvents from '../../../store/FleetActivityEvents.mjs';
import FleetRoster         from '../../../store/FleetRoster.mjs';
import Provider            from '../../../../../node_modules/neo.mjs/src/state/Provider.mjs';
import SpineBanner         from '../../../util/SpineBanner.mjs';
import TelltaleDeriver     from '../../../util/ViewerWakeTelltale.mjs';
import ViewerWakeFeed      from '../../../store/ViewerWakeFeed.mjs';
import {sampleActivity}    from '../../../config/fleetSampleData.mjs';

/**
 * @summary One banner-verdict derivation for the two formulas that render it (`spineBanner` and
 * `instanceState`) — shared so the dot can never disagree with the sentence beside it.
 * @param {Object} data The provider's hierarchical data proxy.
 * @returns {{hidden: Boolean, kind: String, text: String}}
 */
const deriveBannerVerdict = data => SpineBanner.deriveSpineBanner({
    daemon   : {state: data.daemonState,        reason: data.daemonDegradedReason},
    grid     : {state: data.gridAdapterState,   reason: data.gridDegradedReason, connection: data.gridConnection},
    stream   : {state: data.streamAdapterState, reason: data.streamDegradedReason, connection: data.streamConnection},
    transport: data.shellTransport
});

/**
 * @summary The cockpit's state scope — every truth more than one surface reads lives here, so the
 * surfaces BIND instead of being synced (the operator's partial-provider ruling on #50: shared
 * render state moves to the provider; per-pane snapshots stay controller state).
 *
 * The provider hosts three kinds of truth:
 * - **stores** — the roster (autoloaded from the honestly-labelled sample seed), the activity
 *   feed (fixture-seeded the same way) and the bounded viewer-wake feed; panes bind instances
 *   via `bind: {store: 'stores.…'}` — the provider is the sharing scope, never a store singleton.
 * - **data** — the selection pair, the per-surface adapter states with their RETAINED degrade
 *   reasons (per-surface by design: one shared reason field cannot know whose cause it holds),
 *   the Brain daemon verdict + shell transport fact, the viewer-wake truths and the activity
 *   counts.
 * - **formulas** — `spineBanner` (the one banner verdict; the banner and the reconnect
 *   affordance bind it), `instanceState` (the chrome dot's mirror of the same verdict, written
 *   to the VIEWPORT-owned key through setData's closest-owner walk), `daemonFault` (the grid
 *   header's fold) and `viewerWakeTelltale` (the wake chip). Reactivity is PULL-based,
 *   source-exact: `Provider.onConstructed` performs the initial formula run; during that run
 *   each formula pulls its dependencies through the hierarchical data proxy, the Effect
 *   subscribes to those Configs (child and parent alike), and later dependency changes schedule
 *   re-runs automatically. One engine behavior shapes the data block: `setData` drills object
 *   values into LEAF paths, so every derived truth also carries a leaf-complete DATA default —
 *   the declaration that makes each leaf a trackable config for the slot binds. The components
 *   stay presentation-thin; no imperative sync path exists.
 *
 * @class AgentOS.view.fleet.cockpit.StateProvider
 * @extends Neo.state.Provider
 */
class StateProvider extends Provider {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.cockpit.StateProvider'
         * @protected
         */
        className: 'AgentOS.view.fleet.cockpit.StateProvider',
        /**
         * @member {Object} data
         */
        data: {
            /**
             * Live activity fold counts for the stream header, written by the activity read.
             * @member {Object[]} activityCounts=[]
             */
            activityCounts: [],
            /**
             * The retained diagnosis for the DAEMON surface — the "why" the banner names instead
             * of generic copy. Written only by the brain-health apply, from the lifecycle owner's
             * own cause.
             * @member {String|null} daemonDegradedReason=null
             */
            daemonDegradedReason: null,
            /**
             * Brain daemon health — `'running'|'degraded'|'stopped'`, or `null` = never asked.
             * The silence is deliberate: defaulting to `'running'` would assert health on the
             * strength of never having asked.
             * @member {String|null} daemonState=null
             */
            daemonState: null,
            /**
             * The grid surface's adapter state — `'sample'` is the honest cold-first-run badge;
             * absent-item materialization binds to HERE, so a layout commit can never reset a
             * live grid back to sample.
             * @member {String} gridAdapterState='sample'
             */
            gridAdapterState: 'sample',
            /**
             * The roster read owner's finite observation and sanitized reason. Leaf-complete so
             * the banner and dot react to this surface independently of the activity read.
             * @member {Object} gridConnection={state:null,reason:null}
             */
            gridConnection: {state: null, reason: null},
            /**
             * The ROSTER surface's retained degrade reason. Per-surface, not shared: one field
             * for two independently-answering surfaces cannot know whose cause it holds.
             * @member {String|null} gridDegradedReason=null
             */
            gridDegradedReason: null,
            /**
             * The cockpit's projected perspective list — every saved layout (the shipped presets
             * plus captures), the active one, and the latest capture verdict — written by the
             * cockpit's `publishPerspectives`; the perspectives drawer binds to it. Empty `items`
             * means "not projected yet", never "no layouts"; `captureNote` is the latest capture
             * verdict as one sentence (a string leaf — nested objects drill into leaf paths here).
             * @member {Object} perspectives={activeLayoutId:null,captureNote:null,items:[]}
             */
            perspectives: {activeLayoutId: null, captureNote: null, items: []},
            /**
             * The presence-capability envelope riding every admitted roster snapshot — the grid's
             * chip names a degraded producer and clears on recovery; `null` claims nothing.
             * @member {Object|null} presenceCapability=null
             */
            presenceCapability: null,
            /**
             * The cockpit's ONE selection truth: the durable registry key for record-keyed
             * consumers, the canonical `@github` mailbox identity for identity-keyed ones.
             * `selectedAgentIdentity` stays null for a resident without verifiable identity
             * authority — an honest "cannot address", never derived from the registry key.
             * @member {String|null} selectedAgentId=null
             */
            selectedAgentId: null,
            /**
             * @member {String|null} selectedAgentIdentity=null
             */
            selectedAgentIdentity: null,
            /**
             * The shell's transport-boot fact for the banner's cold-case guidance, or `null`
             * where no shell fact exists (the plain browser, or an unreachable shell — which has
             * no standing to keep asserting one).
             * @member {Object|null} shellTransport=null
             */
            shellTransport: null,
            /**
             * The ACTIVITY surface's adapter state — see {@link #data.gridAdapterState}.
             * @member {String} streamAdapterState='sample'
             */
            streamAdapterState: 'sample',
            /**
             * Activity read observation; success/absence clears only this surface's fields.
             * @member {Object} streamConnection={state:null,reason:null}
             */
            streamConnection: {state: null, reason: null},
            /**
             * The ACTIVITY surface's retained degrade reason — see {@link #data.gridDegradedReason}.
             * @member {String|null} streamDegradedReason=null
             */
            streamDegradedReason: null,
            /**
             * The per-viewer wake-push truths, stamped from the stream consumer's OWN
             * observations: `stream` carries the consumer's liveness vocabulary verbatim;
             * `catchUp` keeps failed ≠ empty ≠ fresh as three states, `state: null` being the
             * honest absence of any observation.
             * @member {Object} viewerWake
             */
            viewerWake: {
                stream : {alive: 'unknown', reason: 'wake stream not started', capturedAt: null},
                catchUp: {state: null, at: null, pending: null},
                signals: []
            },
            /* ── leaf-complete DEFAULTS for the formula-owned truths ──
               `setData` drills object values into leaf paths, so each derived object declares
               its full leaf shape here — that declaration is what makes every leaf a trackable
               config for the slot binds. The VALUES are formula-owned below. A truth the
               Viewport provider already declares (`instanceState`) is deliberately NOT
               re-declared — a child redeclaration would SHADOW the parent authority, and the
               formula's setData reaches the closest existing owner on its own. */
            /**
             * Formula-owned — the header's aggregate daemon-fault fold; the SAME fault set the
             * banner ranks, plumbed as a boolean. The grid derives nothing about daemons itself.
             * @member {Boolean} daemonFault=false
             */
            daemonFault: false,
            /**
             * Formula-owned — the one banner verdict; the banner and the reconnect affordance
             * bind its LEAVES (`setData` drills object values into leaf paths — an object-valued
             * key never becomes one trackable config, so consumers bind `data.spineBanner.text`
             * etc. and every leaf is declared here). `text` is the pill's status word; `title`
             * carries the full honesty sentence, `ariaLabel` its screen-reader mirror.
             * @member {Object} spineBanner
             */
            spineBanner: {ariaLabel: '', hidden: false, kind: 'cold', text: '', title: ''},
            /**
             * Formula-owned — the wake chip's derivation; leaf-declared for the same reason.
             * Re-derives on every `viewerWake` stamp beat (the cadence the observations move on).
             * @member {Object} viewerWakeTelltale
             */
            viewerWakeTelltale: {ariaLabel: '', cls: [], text: 'wake off', title: 'wake stream not started'}
        },
        /**
         * The derivations, as REAL formulas — pull-based: the initial run at `onConstructed`
         * pulls each formula's dependencies through the hierarchical data proxy, the Effect
         * subscribes to those Configs, and dependency changes schedule re-runs automatically.
         * `deriveBannerVerdict` (module helper) is shared so the dot mirror can never disagree
         * with the sentence beside it.
         * @member {Object} formulas
         */
        formulas: {
            /**
             * The header's aggregate daemon-fault fold.
             * @param {Object} data
             * @returns {Boolean}
             */
            daemonFault: data => SpineBanner.DAEMON_FAULT_STATES.includes(data.daemonState),
            /**
             * The chrome switcher's dot — live→ok · degraded→limited · cold→off. Writes the
             * VIEWPORT-owned key (setData's closest-owner walk; no local twin is declared).
             * @param {Object} data
             * @returns {String}
             */
            instanceState: data => {
                const verdict = deriveBannerVerdict(data);

                return verdict.hidden ? 'ok' : (verdict.kind === 'degraded' ? 'limited' : 'off')
            },
            /**
             * The one banner verdict `{hidden, kind, text}`.
             * @param {Object} data
             * @returns {Object}
             */
            spineBanner: data => deriveBannerVerdict(data),
            /**
             * The wake chip `{ariaLabel, cls, text, title}` from the stamped consumer
             * observations (bounded signal window included).
             * @param {Object} data
             * @returns {Object}
             */
            viewerWakeTelltale: data => TelltaleDeriver.describeViewerWakeTelltale({
                stream : data.viewerWake.stream ?? null,
                catchUp: data.viewerWake.catchUp?.state ? data.viewerWake.catchUp : null,
                signals: data.viewerWake.signals ?? []
            })
        },
        /**
         * @member {Object} stores
         */
        stores: {
            fleetActivityEvents: {
                data  : sampleActivity,
                module: FleetActivityEvents
            },
            fleetRoster: {
                autoLoad: true,
                module  : FleetRoster
            },
            viewerWakeFeed: {
                module: ViewerWakeFeed
            }
        }
    }

}

export default Neo.setupClass(StateProvider);
