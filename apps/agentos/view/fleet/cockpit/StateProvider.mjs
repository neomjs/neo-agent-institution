import FleetActivityEvents from '../../../store/FleetActivityEvents.mjs';
import FleetRoster         from '../../../store/FleetRoster.mjs';
import Provider            from '../../../../../node_modules/neo.mjs/src/state/Provider.mjs';
import SpineBanner         from '../../../util/SpineBanner.mjs';
import TelltaleDeriver     from '../../../util/ViewerWakeTelltale.mjs';
import ViewerWakeFeed      from '../../../store/ViewerWakeFeed.mjs';
import {sampleActivity}    from '../../../config/fleetSampleData.mjs';

/**
 * The banner verdict's SOURCE keys — a write to any of these re-derives the verdict family.
 * @type {String[]}
 */
const bannerSourceKeys = [
    'daemonDegradedReason', 'daemonState',
    'gridAdapterState', 'gridDegradedReason',
    'shellTransport',
    'streamAdapterState', 'streamDegradedReason'
];

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
 * - **derived data** — `spineBanner` (the one banner verdict; the banner and the reconnect
 *   affordance bind it), `instanceState` (the chrome dot's mirror of the same verdict),
 *   `daemonFault` (the grid header's fold) and `viewerWakeTelltale` (the wake chip). Declared
 *   as data and kept live by {@link #onDataPropertyChange} — the official provider hook — so
 *   the derivation OWNER stays this class and consumers just bind. (Two engine constraints,
 *   both verified in source and live 2026-08-29, shape this: `formulas` on a CHILD provider
 *   never re-run after boot, and `setData` drills object values into LEAF paths, so derived
 *   truths are declared leaf-complete and consumers bind leaves.) The components stay
 *   presentation-thin; no imperative sync path exists.
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
             * The ROSTER surface's retained degrade reason. Per-surface, not shared: one field
             * for two independently-answering surfaces cannot know whose cause it holds.
             * @member {String|null} gridDegradedReason=null
             */
            gridDegradedReason: null,
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
            /* ── the DERIVED truths (written only by this class's own re-derivation hook) ──
               Declared here when the COCKPIT is their owner; a truth the Viewport provider
               already declares (`instanceState`) is deliberately NOT re-declared — a child
               redeclaration SHADOWS the parent authority instead of feeding it, and setData
               reaches the closest existing owner on its own. */
            /**
             * DERIVED — the header's aggregate daemon-fault fold; the SAME fault set the banner
             * ranks, plumbed as a boolean. The grid derives nothing about daemons itself.
             * @member {Boolean} daemonFault=false
             */
            daemonFault: false,
            /**
             * DERIVED — the one banner verdict; the banner and the reconnect affordance bind its
             * LEAVES (`setData` drills object values into leaf paths — an object-valued key never
             * becomes one trackable config, so consumers bind `data.spineBanner.text` etc. and
             * every leaf is declared here). Seeded by {@link #onConstructed}'s first derivation.
             * @member {Object} spineBanner
             */
            spineBanner: {hidden: false, kind: 'cold', text: ''},
            /**
             * DERIVED — the wake chip's derivation; leaf-declared for the same reason. Re-derives
             * on every `viewerWake` stamp beat (the cadence the observations move on).
             * @member {Object} viewerWakeTelltale
             */
            viewerWakeTelltale: {ariaLabel: '', cls: [], text: 'wake: not started', title: ''}
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

    /**
     * @summary Seed the derived truths once every declared default exists — the same derivation
     * {@link #onDataPropertyChange} keeps live afterwards.
     */
    onConstructed() {
        super.onConstructed();

        this.deriveBannerTruths();
        this.deriveViewerWakeTelltale()
    }

    /**
     * @summary The provider-owned re-derivation seam — the official subclass hook, fired on every
     * data write: a banner SOURCE key re-derives the verdict family, a `viewerWake` stamp
     * re-derives the chip. Derived keys re-enter this hook and match no source, so the recursion
     * terminates by construction.
     * @param {String} key
     * @param {*} value
     * @param {*} oldValue
     */
    onDataPropertyChange(key, value, oldValue) {
        super.onDataPropertyChange(key, value, oldValue);

        // `setData` drills object writes into LEAF paths, so a source match is prefix-shaped;
        // the derived keys are no source, which terminates the recursion by construction
        bannerSourceKeys.some(source => key === source || key.startsWith(source + '.')) && this.deriveBannerTruths();

        (key === 'viewerWake' || key.startsWith('viewerWake.')) && this.deriveViewerWakeTelltale()
    }

    /**
     * @summary One banner derivation pass: verdict, dot state and daemon fold — three renderers,
     * one truth, derived where the truth lives.
     * @protected
     */
    deriveBannerTruths() {
        const
            me      = this,
            data    = me.getHierarchyData(),
            verdict = SpineBanner.deriveSpineBanner({
                daemon   : {state: data.daemonState,        reason: data.daemonDegradedReason},
                grid     : {state: data.gridAdapterState,   reason: data.gridDegradedReason},
                stream   : {state: data.streamAdapterState, reason: data.streamDegradedReason},
                transport: data.shellTransport
            });

        me.setData({
            daemonFault: SpineBanner.DAEMON_FAULT_STATES.includes(data.daemonState),
            spineBanner: verdict,
            // NOT declared locally: `instanceState` is Viewport-provider data (the instance
            // switcher binds it there) — setData walks to the closest existing OWNER, so this
            // write updates the PARENT truth instead of shadowing it with a child twin
            instanceState: verdict.hidden ? 'ok' : (verdict.kind === 'degraded' ? 'limited' : 'off')
        })
    }

    /**
     * @summary The wake-chip derivation — the consumer's stamped observations (bounded signal
     * window included) reduced to `{ariaLabel, cls, text, title}`.
     * @protected
     */
    deriveViewerWakeTelltale() {
        // LEAF reads on purpose: a stamp's per-leaf writes fire this hook BEFORE the engine
        // re-bubbles the parent objects, so an object-path read inside the hook still sees the
        // previous composite — the leaves are already current, and the stamp's LAST leaf write
        // makes this derivation the one that sticks
        const
            me      = this,
            stream  = {
                alive     : me.getData('viewerWake.stream.alive'),
                reason    : me.getData('viewerWake.stream.reason'),
                capturedAt: me.getData('viewerWake.stream.capturedAt')
            },
            catchUp = {
                state  : me.getData('viewerWake.catchUp.state'),
                at     : me.getData('viewerWake.catchUp.at'),
                pending: me.getData('viewerWake.catchUp.pending')
            },
            signals = me.getData('viewerWake.signals');

        me.setData('viewerWakeTelltale', TelltaleDeriver.describeViewerWakeTelltale({
            stream,
            catchUp: catchUp.state ? catchUp : null,
            signals: signals ?? []
        }))
    }
}

export default Neo.setupClass(StateProvider);
