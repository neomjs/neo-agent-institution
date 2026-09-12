import Base from '../../../node_modules/neo.mjs/src/core/Base.mjs';

/**
 * Static factory for the Fleet Cockpit dock document.
 * @class AgentOS.util.CockpitDockDocument
 * @extends Neo.core.Base
 */
class CockpitDockDocument extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.util.CockpitDockDocument'
         * @protected
         */
        className: 'AgentOS.util.CockpitDockDocument'
    }

    /**
     * The Fleet Cockpit's default dock layout, expressed as pure `neo.dock.zone.v1` data.
     *
     * @summary The SSOT §01 mission-control split under the shell's one-navigation-vocabulary model —
     * the **fleet zone** (~1.55fr: the density-ranked agent-card roster + the scale-to-a-glance health
     * bar) above the **south reading-surface tabs** (1fr: Activity · Memories · Mailbox · Catch-up —
     * the fleet-scoped continuous reading surfaces an operator returns to many times per session),
     * with the right edge reserved for selection-scoped inspection (agent detail) and invoked tools,
     * declared `autoHidden` (the input the edge-rail auto-hide contract consumes). Roster-agnostic —
     * the fleet zone is one `reference`, never a per-agent item list, so the document holds for any
     * fleet size.
     *
     * The region jobs follow that model: south tabs are resident reading surfaces (never
     * rail-squeezed), the rail carries the inspector plus invoked tools only. The Tasks surface joins
     * the south family when it lands.
     *
     * This is a **data leaf only**. The projection / render + resize-commit wiring is the sibling leaf;
     * nothing here reads a `DOMRect`, mounts a component, or touches the drag lifecycle. The document
     * round-trips `Neo.dashboard.dock.model.WorkspaceDocument.validate` (empty error list) and feeds
     * `Neo.dashboard.dock.projection.LayoutAdapter` unchanged. It is intentionally a factory returning a fresh
     * object per call — never a shared mutable singleton — so consumers and the semantic operations
     * (which deep-clone) never alias one authored default.
     *
     * `reference` values name the `AgentOS.view.fleet.*` keeper-view surfaces — the engine's own
     * component-lookup key, so a projected pane answers `getReference()` by the name the record
     * carries; the exact secondary-pane inventory tracks the FM cockpit SSOT map and may be pinned
     * as that map lands.
     *
     * @returns {Object} a fresh `neo.dock.zone.v1` document
     */
    static create() {
        return {
            schema: 'neo.dock.zone.v1',
            root  : 'cockpit-root',
            items : {
                fleet : {reference: 'fleet-grid',       title: 'Fleet'},
                stream: {reference: 'activity-stream',   title: 'Activity'},
                // south reading surfaces: per-agent session-summary recall, the operator's own
                // mailbox + compose surface, and the historical Bird-View complement to the
                // bounded Activity stream — resident tabs beside it, never rail-squeezed
                memories    : {reference: 'memories',          title: 'Memories'},
                // the WHAT axis of mission control: running / queued / recent work, beside the WHO grid
                tasks       : {reference: 'tasks',             title: 'Tasks'},
                operator    : {reference: 'operator-mailbox',  title: 'Mailbox'},
                catchUp     : {reference: 'catch-up',          title: 'Catch up'},
                // the inspector and the invoked tools: auto-hidden onto the right edge's rail
                detail      : {reference: 'agent-detail',      title: 'Agent detail', autoHidden: true},
                perspectives: {reference: 'perspectives',      title: 'Perspectives', autoHidden: true},
                // S5 define-agent (design ruling on record: rail placement, invoked-not-ambient) —
                // the add-agent flow rides the same autoHidden tool chrome as perspectives
                defineAgent: {reference: 'define-agent',      title: 'Add agent',    autoHidden: true},
                wakeRoutes : {reference: 'wakeRoutes',        title: 'Wake routes',  autoHidden: true}
            },
            nodes: {
                // Root edge-zone: the primary split in the center; the right edge is a RESIZABLE band with a
                // committed extent. Every member is auto-hidden at boot, so the engine projects the band
                // rail-only (an all-railed band gets no splitter by design); the moment a member is pinned
                // open (the Review preset) the same descriptor renders the real edge splitter, and the
                // reveal overlay reads the same committed extent — one authority for both readers.
                'cockpit-root'  : {type: 'edge-zone', zones: {center: {nodeId: 'primary-split'}, right: {nodeId: 'secondary-rail', extent: 0.25, resizable: true}}},
                // SSOT §01: fleet zone (~1.55fr) on top, the reading-surface tabs (1fr) docked at the bottom — vertical split, normalized to sum 1.
                'primary-split': {type: 'split', orientation: 'vertical', children: ['fleet-tabs', 'stream-tabs'], sizes: [0.6078, 0.3922]},
                'fleet-tabs'   : {type: 'tabs', items: ['fleet'], activeItemId: 'fleet'},
                // the south reading-surface family: Activity active by default, Tasks directly beside it.
                'stream-tabs'  : {type: 'tabs', items: ['stream', 'tasks', 'memories', 'operator', 'catchUp'], activeItemId: 'stream'},
                // Secondary panes collapse to this edge's rail (§2.7): inspector + invoked tools only; their item records carry `autoHidden`.
                'secondary-rail': {type: 'tabs', items: ['detail', 'perspectives', 'defineAgent', 'wakeRoutes'], activeItemId: 'detail'}
            }
        }
    }
}

export default Neo.setupClass(CockpitDockDocument);
