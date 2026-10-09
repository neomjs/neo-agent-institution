import Accounts           from './accounts/Panel.mjs';
import AgentDefinitions   from '../store/AgentDefinitions.mjs';
import BaseViewport       from '../../../node_modules/neo.mjs/src/container/Viewport.mjs';
import Dashboard          from '../../../node_modules/neo.mjs/src/dashboard/Container.mjs';
import DeploymentStateRead from '../util/DeploymentStateRead.mjs';
import FleetAwaitingMerge from '../store/FleetAwaitingMerge.mjs';
import FleetCockpit       from './fleet/cockpit/Container.mjs';
import FleetInstances     from '../store/FleetInstances.mjs';
import FleetRoster        from '../store/FleetRoster.mjs';
import FleetTenants       from '../store/FleetTenants.mjs';
import GoldenPathEnvelope from '../util/GoldenPathEnvelope.mjs';
import GraphSceneEnvelope from '../util/GraphSceneEnvelope.mjs';
import HomeView           from './home/Container.mjs';
import InstanceSwitcher   from './fleet/instances/SwitcherButton.mjs';
import ObservatoryPane    from './fleet/goldenpath/ObservatoryContainer.mjs';
import StateProvider      from '../../../node_modules/neo.mjs/src/state/Provider.mjs';
import SystemView         from './system/Container.mjs';
import TabContainer       from '../../../node_modules/neo.mjs/src/tab/Container.mjs';
import ViewportController from './ViewportController.mjs';

/**
 * @summary A keeper-rail tab header. Its tooltip opens to the icon's right (`l-r`), clear of the rail; the
 * default below-the-target placement lands on the next icon.
 * @param {String} iconCls
 * @param {String} route
 * @param {String} text The tab's accessible name and tooltip
 * @returns {Object}
 */
const railHeader = (iconCls, route, text) => ({iconCls, route, text, tooltip: {text, align: {edgeAlign: 'l-r'}}});

/**
 * @class AgentOS.view.Viewport
 * @extends Neo.container.Viewport
 *
 * @summary The harness shell — the B3-hybrid keeper-view structure: a top chrome bar over a
 * stable-shell **left-rail keeper-view nav** (`tab.Container`, left tab-bar). The rail is how you
 * reach the keeper views — **Home** (the Welcome landing), **Fleet** (the FM mission-control
 * cockpit, the default), **Observatory** (the Golden Path's graph neighbourhood as a 3D scene, the whole view), **System** (the connected instance's engine room: plane health from the
 * orchestrator's deployment-state picture, observe-only), **Accounts** (identity setup), **Chat**
 * (prompt → live pane, the dockable work-area seam). The Fleet keeper-view renders the roster as CARDS (the design SSOT), not a
 * data-grid table. Renders through `neo-theme-neo-dark` / `neo-theme-neo-light`.
 *
 * The Viewport is also the composition authority between two deliberately separate projections:
 * Accounts owns `AgentDefinitions`, while FleetCockpit's liveness owner fills `FleetRoster`, which this
 * provider hosts so Home and Accounts' Repositories card read the same roster. An accepted definition
 * event is routed here so the cockpit can re-poll its Brain-side `fleetRoster()` assembler; neither
 * sibling writes or locally maps the other's store.
 */
class Viewport extends BaseViewport {
    static config = {
        /**
         * @member {String} className='AgentOS.view.Viewport'
         * @protected
         */
        className: 'AgentOS.view.Viewport',
        /**
         * @member {String[]} cls=['agent-os-viewport']
         * @reactive
         */
        cls: ['agent-os-viewport'],
        /**
         * @member {Neo.controller.Component} controller=ViewportController
         * @reactive
         */
        controller: ViewportController,
        /**
         * @member {Object} layout={ntype:'vbox',align:'stretch'}
         * @reactive
         */
        layout: {ntype: 'vbox', align: 'stretch'},
        /**
         * The shell-level shared-store host — the one sharing scope every consumer resolves
         * (Accounts writes into it; the cockpit's detail configuration tab reads it; each binds
         * or resolves the instance at construct, so a pop-out reparent keeps the reference).
         * Store classes are NOT singletons — the provider IS the sharing mechanism.
         * @member {Object} stateProvider
         */
        stateProvider: {
            module: StateProvider,
            data  : {
                // the bound instance's profileId — MIRRORED from the published bridge's
                // `profileId` (the SSOT) by the switch/boot owner; consumers bind, never derive
                boundProfileId: null,
                // the bound instance's connection state as a session-state key — written at the
                // spine banner's sync point, so the chrome dot and the banner share ONE truth
                instanceState: 'off',
                // the packaged shell holds fleet custody in main: the switcher then shows the
                // shell's own binding (the attached plane's base, `null` for this machine's organism)
                shellCustody  : false,
                shellPlaneBase: null,
                // `false` for a packaged shell without a plane, published by the controller from the
                // shell's plane status: Home then shows only *Connect a plane*
                shellPlaneConfigured: null,
                // the ROSTER surface's truths, written by the cockpit's liveness owner and declared
                // HERE so Home reads them too: the adapter state (`'cold'` until a source answers,
                // then `'live'` or `'stale'`), the read's own observation, and its retained degrade
                // reason, per surface, since one shared field cannot know whose cause it holds
                gridAdapterState  : 'cold',
                gridConnection    : {state: null, reason: null},
                gridDegradedReason: null,
                // the open-work read's own state, written by the cockpit's read owner with each answer
                // and bound by the fleet head's awaiting-merge button; leaf-complete by construction,
                // every leaf null until the first answer lands
                openWork: {coverage: null, observedAt: null, reason: null, state: null},
                // the operator line's questions axis, projected by the same read owner from the same
                // answer: its source's state and reason, leaf-complete like `openWork`
                questions: {count: null, reason: null, state: null},
                // the connected instance's deployment-state picture — the System keeper-view's plane
                // truth, written by the cockpit's read owner through setData's closest-owner walk and
                // declared HERE so a sibling keeper-view can bind it; leaf-complete by construction
                // (a block declared null would stop the leaf bubble on its first real answer)
                deploymentState: DeploymentStateRead.blank(),
                // the first-run recipe's projected progress and run, written by the setup card's
                // Create door from its step rows alone (never from the record) and declared HERE so
                // the chrome's progress line binds it; leaf-complete by construction, every leaf
                // null until a recipe evaluation lands
                setupProgress: {blocking: null, next: null, ok: null, total: null},
                setupRun     : {dataRoot: null, decisions: null, manualActions: null, planeId: null, preset: null, recipeVersion: null, runId: null},
                // the Golden Path envelope, same shape of ownership: the cockpit's Golden Path read
                // writes it, the cockpit's reading panes bind it
                goldenPathEnvelope: GoldenPathEnvelope.blank(),
                // the bounded graph neighbourhood around that route, its own read and its own currency:
                // a graph read never rewrites the Golden Path leaf, and the Observatory binds this one
                graphSceneEnvelope: GraphSceneEnvelope.blank(),
                // the one selected graph node, by its origin-qualified id: the Observatory and the Golden
                // Path pane both bind it both ways, so a choice in either is the selection in both
                graphSelectionId: null,
                // that read owner's connection observation, the System view's own surface
                systemConnection: {state: null, reason: null},
                // the instant of that owner's latest cadence tick it could not spend on a read (its
                // slots held by reads hanging past their bound): no observation changes on such a
                // tick, but the retained picture's age must keep moving from the reader's anchor
                systemTickAt: null
            },
            stores: {
                agentDefinitions: {
                    module: AgentDefinitions
                },
                fleetAwaitingMerge: {
                    module: FleetAwaitingMerge
                },
                fleetInstances: {
                    module: FleetInstances
                },
                fleetRoster: {
                    module: FleetRoster
                },
                fleetTenants: {
                    module: FleetTenants
                }
            }
        },
        /**
         * Top chrome (logo · title · instance switcher · theme switch) over the left-rail
         * keeper-view nav. The switcher sits in the LEFT cluster directly after the title — scope
         * reads left-to-right: product → instance → everything below is instance-relative.
         * @member {Object[]} items
         */
        items: [{
            ntype: 'toolbar',
            cls  : ['agent-top-toolbar'],
            flex : 'none',
            items: [{
                ntype: 'component',
                cls  : ['agent-logo'],
                vdom : {cn: [{tag: 'img', src: '../../resources/images/logo/neo_logo_primary.svg', alt: 'Neo.mjs'}]}
            }, {
                ntype: 'label',
                cls  : ['agent-shell-title'],
                text : 'Agent OS'
            }, {
                module   : InstanceSwitcher,
                reference: 'instance-switcher',
                bind     : {
                    boundProfileId: data => data.boundProfileId,
                    instanceState : data => data.instanceState,
                    instanceStore : 'stores.fleetInstances',
                    shellCustody  : data => data.shellCustody,
                    shellPlaneBase: data => data.shellPlaneBase
                },
                listeners: {
                    attachplane    : 'onAttachPlane',
                    manageinstances: 'onManageInstances',
                    switchinstance : 'onSwitchInstance'
                }
            }, {
                // the recipe's projected progress IS the shell spec's visible, honest progress line:
                // `n of m observed ok · next: <step>`, from the step rows only; absent before a run
                ntype    : 'component',
                cls      : ['agent-setup-progress'],
                reference: 'setup-progress',
                bind     : {
                    hidden: data => data.setupProgress.total === null,
                    text  : data => {
                        const {blocking, next, ok, total} = data.setupProgress;

                        if (total === null) return '';

                        const tail = blocking ? `${blocking} needs attention` : next ? `next: ${next}` : 'complete';

                        return `${ok} of ${total} observed ok · ${tail}`
                    }
                }
            }, '->', {
                ntype    : 'button',
                cls      : ['agent-button', 'agent-theme-button'],
                handler  : 'onSwitchTheme',
                iconCls  : 'fa-solid fa-moon',
                reference: 'theme-switch-button',
                tooltip  : {
                    text     : 'Switch theme',
                    showDelay: 0,
                    hideDelay: 0
                }
            }]
        }, {
            module               : TabContainer,
            cls                  : ['agent-shell'],
            flex                 : 1,
            reference            : 'shell',
            tabBarPosition       : 'left',
            // the icon rail marks its active place with a pressed button: no indicator, no strip beside it
            tabStrip             : {hidden: true},
            useActiveTabIndicator: false,
            activeIndex          : 1, // default to the Fleet cockpit — mission control first

            items: [{
                module   : HomeView,
                header   : railHeader('fa-solid fa-house', '/home', 'Home'),
                listeners: {mergeQueueOpen: 'onHomeMergeQueueOpen'},
                reference: 'home-view'
            }, {
                module   : FleetCockpit,
                header   : railHeader('fa-solid fa-satellite-dish', '/fleet', 'Fleet'),
                reference: 'fleet-cockpit'
            }, {
                // the Golden Path's neighbourhood as a scene takes the whole view: its follow-ups need room beside it
                module   : ObservatoryPane,
                header   : railHeader('fa-solid fa-circle-nodes', '/observatory', 'Observatory'),
                listeners: {sessionOpen: 'onObservatorySessionOpen'},
                reference: 'observatory-view',
                bind     : {
                    envelope     : data => data.graphSceneEnvelope,
                    routeEnvelope: data => data.goldenPathEnvelope,
                    selectedId   : {key: 'graphSelectionId', twoWay: true}
                }
            }, {
                // the engine room beside mission control: what the planes are doing to the fleet's
                // truth — a distinct subject, so a distinct place in the rail (never a cockpit pane)
                module   : SystemView,
                header   : railHeader('fa-solid fa-server', '/system', 'System'),
                reference: 'system-view'
            }, {
                // Accounts is likewise a dashboard.Panel — its own dashboard.Container host so the
                // identity panel keeps the pop-out affordance and stays structurally idiomatic.
                module   : Dashboard,
                cls      : ['agent-accounts-dashboard'],
                header   : railHeader('fa-solid fa-id-badge', '/accounts', 'Accounts'),
                popupUrl : 'apps/agentos/childapps/widget/index.html',
                sortGroup: 'neo-connected-dashboard',
                sortZoneConfig: {dragHandleSelector: '.fm-accounts-drag-handle'},

                items: [{
                    module   : Accounts,
                    flex     : 1,
                    listeners: {agentDefinitionAccepted: 'up.onAgentDefinitionAccepted'},
                    reference: 'accounts'
                }]
            }, {
                ntype : 'component',
                cls   : ['agent-placeholder'],
                header: railHeader('fa-solid fa-comments', '/chat', 'Chat'),
                html  : '<div class="agent-placeholder-inner">Chat — prompt an agent → a live widget pane you can dock and pop out. The dockable QT work-area lands here next.</div>'
            }]
        }]
    }

    /**
     * @summary Route an accepted Accounts definition across the keeper-view composition boundary:
     * FleetCockpit re-polls the Brain's authoritative roster assembler into its own FleetRoster
     * store. Invalid events or an absent cockpit fail closed without a sibling-store mutation.
     * @param {Object} data
     * @param {Object} data.agent Canonical public agent definition accepted by Accounts.
     * @returns {Promise<Boolean>} True after the cockpit refresh settles; false when no valid route exists.
     */
    async onAgentDefinitionAccepted({agent}={}) {
        const
            me      = this,
            cockpit = me.getReference('fleet-cockpit');

        if (!agent?.id) {
            return false
        }

        // land the canonical readback in the shared definitions store: the S5 zone's form ends at
        // this event by design (the mount owner writes), and the config tab reads the same rows.
        // Accounts upserts its own row before firing, so this is idempotent for that path; with
        // no provider in reach (bare mounts) the write degrades away and the roster refresh stands.
        const
            store  = me.getStateProvider?.()?.getStore('agentDefinitions'),
            record = store?.get(agent.id);

        record ? record.set(agent) : store?.add(agent);

        if (typeof cockpit?.loadRoster !== 'function') {
            return false
        }

        await cockpit.loadRoster();

        return true
    }
}

export default Neo.setupClass(Viewport);
