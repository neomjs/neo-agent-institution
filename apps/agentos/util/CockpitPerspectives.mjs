import Base               from '../../../node_modules/neo.mjs/src/core/Base.mjs';
import Button             from '../../../node_modules/neo.mjs/src/button/Base.mjs';
import Persistence        from '../../../node_modules/neo.mjs/src/dashboard/dock/model/Persistence.mjs';
import PerspectiveLibrary from '../../../node_modules/neo.mjs/src/dashboard/dock/persistence/PerspectiveLibrary.mjs';
import WorkspaceDocument  from '../../../node_modules/neo.mjs/src/dashboard/dock/model/WorkspaceDocument.mjs';

/**
 * What a captured perspective's id folds away: everything but lowercase letters and digits
 * collapses to one hyphen.
 * @type {RegExp}
 */
const idFold = /[^a-z0-9]+/g;

/**
 * The hyphens a folded id sheds at either end.
 * @type {RegExp}
 */
const edgeHyphens = /^-+|-+$/g;

/**
 * The declared duties, in bar order: the name the engine selects by, the title the drawer shows,
 * and the arrangement each one is.
 * @type {{name: String, title: String, zones: Object}[]}
 */
const duties = [
    {name: 'Overview', title: 'Overview — mission control',     zones: {}},
    {name: 'Focus',    title: 'Focus — roster dominant',        zones: {sizes: [0.85, 0.15]}},
    {name: 'Review',   title: 'Review — one agent + the trail', zones: {sizes: [0.45, 0.55], detailColumn: true}}
];

/**
 * One arrangement of the cockpit's pane catalog as a `zones` declaration — the tree every
 * perspective shares, varied by the primary split's sizes and by where the inspector lives:
 * railed in the right band (auto-hidden, revealed on demand) or docked as a center column beside
 * the split. Node ids are explicit and stable across perspectives, so a persisted capture keyed by
 * them restores into any of them.
 * @param {Object} [options={}]
 * @param {Number[]} [options.sizes=[0.6078, 0.3922]] The fleet-over-stream split
 * @param {Boolean} [options.detailColumn=false] Dock the inspector as a center column
 * @returns {Object} a fresh `zones` declaration
 */
function arrangement({sizes = [0.6078, 0.3922], detailColumn = false} = {}) {
    const primarySplit = {
        id         : 'primary-split',
        orientation: 'vertical',
        sizes,
        children   : [
            {id: 'fleet-tabs',  items: ['fleet']},
            {id: 'stream-tabs', items: ['stream', 'tasks', 'memories', 'operator', 'catchUp']}
        ]
    };

    return {
        id    : 'cockpit-root',
        // the column takes the band's committed quarter, so the roster keeps its two-card rows
        center: detailColumn
            ? {id: 'review-split', orientation: 'horizontal', sizes: [0.75, 0.25], children: [primarySplit, {id: 'detail-tabs', items: ['detail']}]}
            : primarySplit,
        right : {
            id       : 'secondary-rail',
            items    : detailColumn ? ['perspectives', 'defineAgent', 'wakeRoutes'] : ['detail', 'perspectives', 'defineAgent', 'wakeRoutes'],
            extent   : 0.25,
            resizable: true
        }
    }
}

/**
 * The Fleet Cockpit's perspectives: the three declared duties as `zones` the engine selects
 * through `activePerspective`, the bar buttons pressed by its published `dock.perspective.active`,
 * the empty library a cockpit files its captures into, and the wrapper that turns the live dock
 * document into one saved layout. A capture is a snapshot beside the declared list, never a
 * perspective of its own. Every factory returns fresh data — the engine clones declarations and
 * the library clones records, and nothing may alias one cockpit's perspectives into another's.
 * @class AgentOS.util.CockpitPerspectives
 * @extends Neo.core.Base
 */
class CockpitPerspectives extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.util.CockpitPerspectives'
         * @protected
         */
        className: 'AgentOS.util.CockpitPerspectives'
    }

    /**
     * @summary The declared duties — the SSOT §01 variants as named `zones` over the one pane
     * catalog, the engine's `perspectives` config:
     *
     * - **Overview** — mission control: the fleet zone (~1.55fr: the density-ranked roster + the
     *   health bar) above the south reading-surface tabs (1fr: Activity · Tasks · Memories ·
     *   Mailbox · Catch up), with the right edge a RESIZABLE band at a committed extent carrying
     *   the inspector and the invoked tools — every member auto-hidden, so the engine projects
     *   the band rail-only until one is revealed.
     * - **Focus** — the roster dominant; the activity stream stays a thin live strip.
     * - **Review** — one agent under review: the inspector docked as a center column beside a
     *   split leaning toward the activity stream, the band keeping the three tools. A declared
     *   perspective cannot pin a rail member open — `autoHidden` is a catalog field, shared by
     *   every perspective — so the reading surface docks as a real split child instead; the
     *   engine keeps a center member in the tab flow with the flag set.
     *
     * Node ids are explicit: every persisted capture keys these names, and the engine retains an
     * explicit id through lowering.
     * @returns {Object} `{Overview, Focus, Review}`, fresh zones per call
     */
    static declare() {
        return Object.fromEntries(duties.map(({name, zones}) => [name, arrangement(zones)]))
    }

    /**
     * @summary The declared duties as rows of the projected perspective list, ahead of the
     * captures: the same shape the library lists, `captureScope` null because nothing captured
     * them.
     * @returns {Object[]} fresh rows
     */
    static rows() {
        return duties.map(({name, title}) => ({captureScope: null, layoutId: name, perspectiveName: name, title}))
    }

    /**
     * @summary The preset switcher's declared buttons, one per duty in bar order, each pressed by
     * PUBLISHED truth: `dock.perspective.active` is the engine's committed name, so a switch from
     * any writer (a click, the Neural Link, a bound provider leaf) presses the right button with
     * no reconcile. `presetName` rides each button so the controller relay switches without a
     * per-button closure; the reference keys the duty for tests and the Neural Link.
     * @returns {Object[]} fresh button configs
     */
    static buttons() {
        return duties.map(({name}) => ({
            module    : Button,
            cls       : ['fm-preset-button'],
            handler   : 'onPresetSelect',
            presetName: name,
            reference : `fleet-preset-${name.toLowerCase()}`,
            text      : name,
            bind      : {pressed: data => data.dock.perspective.active === name}
        }))
    }

    /**
     * @summary A fresh, empty `neo.dock.layoutCollection.v1` collection for the cockpit's capture
     * library, validated by the same wrapper a capture saves through, so an empty library never
     * differs in shape from a filled one.
     * @returns {Object}
     */
    static emptyCollection() {
        const {collection, errors} = PerspectiveLibrary.createSavedLayoutCollection([], {
            activeLayoutId: null,
            metadata      : {owner: 'fm-cockpit'}
        });

        if (errors.length) {
            throw new Error(`CockpitPerspectives: the empty collection failed validation: ${errors.join('; ')}`)
        }

        return collection
    }

    /**
     * @summary TRUE only when a document actually REVEALS the inspector: the detail item sits in a
     * tabs node of the tree (absence fails — a valid no-detail document must never read as
     * revealed), is not railed away as an auto-hidden EDGE member, and is its node's active tab or
     * the node's only member. The `autoHidden` flag alone cannot answer it: the catalog field is
     * shared by every declared perspective, and a center member (Review's column) keeps it while
     * the engine leaves it in the tab flow — so the placement decides, not the flag.
     * @param {Object} document A committed `neo.dock.zone.v1` document.
     * @returns {Boolean}
     */
    static revealsInspector(document) {
        const tabsId = WorkspaceDocument.findContainingTabsId(document, 'detail'),
              node   = tabsId ? document.nodes[tabsId] : null,
              railed = document.items.detail?.autoHidden === true && this.isEdgeMember(document, tabsId);

        return !!node && !railed && (node.activeItemId === 'detail' || node.items.length === 1)
    }

    /**
     * @summary Whether a node descends from one of the root's EDGE zones — the bands whose
     * auto-hidden members collapse into a rail — rather than from the center.
     * @param {Object} document A `neo.dock.zone.v1` document.
     * @param {String|null} nodeId
     * @returns {Boolean}
     */
    static isEdgeMember(document, nodeId) {
        const {nodes}  = document,
              descends = fromId => fromId === nodeId || (nodes[fromId]?.children ?? []).some(descends);

        return !!nodeId && Object.entries(nodes[document.root]?.zones ?? {})
            .some(([edge, zone]) => edge !== 'center' && descends(zone.nodeId))
    }

    /**
     * @summary Wrap the live dock document as a saved layout under an operator-given name — the
     * capture half of the perspectives drawer. The id is `capture-` plus the folded name (lowercase
     * letters, digits and single hyphens; a name of nothing but punctuation folds to `layout`) —
     * the prefix keeps a capture's id off the declared duties' names, so a capture can never
     * shadow a duty by id, and a name in `reserved` (the duties) is refused before the document is
     * read. The title is the name itself, and the source stamp separates a capture from anything
     * the cockpit ships. Document validation is the wrapper's, and the library clones at save
     * time; an unnamed capture is refused here because it has nothing to be filed under.
     * @param {Object} document The committed `neo.dock.zone.v1` document.
     * @param {String} name The operator's name for the layout.
     * @param {String[]} [reserved=[]] Names a capture may not take — the declared duties.
     * @returns {{layout: (Object|null), errors: String[]}}
     */
    static captureSavedLayout(document, name, reserved = []) {
        const perspectiveName = (name ?? '').trim();

        if (!perspectiveName) {
            return {layout: null, errors: ['a perspective needs a name']}
        }

        if (reserved.includes(perspectiveName)) {
            return {layout: null, errors: [`"${perspectiveName}" is a declared perspective — a capture needs its own name`]}
        }

        const layoutId = `capture-${perspectiveName.toLowerCase().replace(idFold, '-').replace(edgeHyphens, '') || 'layout'}`;

        return Persistence.createSavedLayout(document, {
            layoutId,
            perspectiveName,
            title   : perspectiveName,
            metadata: {source: 'fm-cockpit-capture'}
        })
    }
}

export default Neo.setupClass(CockpitPerspectives);
