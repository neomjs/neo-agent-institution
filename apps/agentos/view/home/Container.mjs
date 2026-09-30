import BaseContainer          from '../../../../node_modules/neo.mjs/src/container/Base.mjs';
import Button                 from '../../../../node_modules/neo.mjs/src/button/Base.mjs';
import FleetAgent             from '../../model/FleetAgent.mjs';
import HomeCanvas             from './Canvas.mjs';
import {INSTANCE_STATE_WORDS} from '../fleet/instances/SwitcherButton.mjs';

/**
 * @summary What FM is, in one line: the display line's words for a first-time reader.
 * @type {String}
 */
const PRODUCT_LINE = 'Mission control for a cross-model AI engineering team.';

/**
 * @summary One door per keeper view, named by the question the view answers.
 * @param {String} iconCls  The view's rail icon
 * @param {String} route    The view's route
 * @param {String} question What the view answers
 * @returns {Object}
 */
const door = (iconCls, route, question) => ({
    module: Button,
    cls   : ['agent-button', 'fm-home-door'],
    flex  : 'none',
    iconCls,
    route,
    text  : question
});

/**
 * Home, the rail's first keeper view. For the returning team it answers "is the team alive, and
 * where do I go?": the team line leads in the display slot, the plane line speaks only when the plane
 * is not connected, and one door leads to each view. For a first-time operator in a packaged shell
 * without a plane it says what FM is and offers one action, *Connect a plane*, with nothing that reads
 * as fleet state. Behind both, a field on the canvas worker ({@link AgentOS.view.home.Canvas}) takes the
 * pointer from the whole view and draws one mark per rostered agent from the team line's own read.
 *
 * @summary Binds the Viewport provider's roster store and the roster surface's truths (the cockpit's
 * liveness owner fills them), `instanceState` (the chrome switcher's verdict and vocabulary) and
 * `shellPlaneConfigured`, which the ViewportController publishes from the shell's plane status
 * (`false` only for a packaged shell without a plane).
 *
 * @class AgentOS.view.home.Container
 * @extends Neo.container.Base
 */
class Container extends BaseContainer {
    static config = {
        /**
         * @member {String} className='AgentOS.view.home.Container'
         * @protected
         */
        className: 'AgentOS.view.home.Container',
        /**
         * @member {String} ntype='fm-home-view'
         * @protected
         */
        ntype: 'fm-home-view',
        /**
         * @member {String[]} baseCls=['fm-home-view']
         */
        baseCls: ['fm-home-view'],
        /**
         * @member {Object} bind
         */
        bind: {
            gridAdapterState    : data => data.gridAdapterState,
            gridDegradedReason  : data => data.gridDegradedReason,
            instanceState       : data => data.instanceState,
            rosterStore         : 'stores.fleetRoster',
            shellPlaneConfigured: data => data.shellPlaneConfigured
        },
        /**
         * The pointer anywhere on Home reaches the field, over the hero's lines too.
         * @member {Object} domListeners
         */
        domListeners: {
            click     : 'onFieldClick',
            mouseleave: 'onFieldLeave',
            mousemove : {fn: 'onFieldMove', local: true}
        },
        /**
         * The roster surface's adapter state: `cold` until the read answers, then `live` or `stale`.
         * @member {String} gridAdapterState_='cold'
         * @reactive
         */
        gridAdapterState_: 'cold',
        /**
         * The roster surface's retained degrade reason, `null` while the read is well.
         * @member {String|null} gridDegradedReason_=null
         * @reactive
         */
        gridDegradedReason_: null,
        /**
         * The chrome's connection verdict for the bound instance: `ok` · `limited` · `off` · `starting`.
         * @member {String} instanceState_='off'
         * @reactive
         */
        instanceState_: 'off',
        /**
         * The roster the cockpit's liveness owner fills; the team line counts it.
         * @member {AgentOS.store.FleetRoster|null} rosterStore_=null
         * @reactive
         */
        rosterStore_: null,
        /**
         * `false` for a packaged shell without a plane, `true` for one with a plane, `null` outside a shell.
         * @member {Boolean|null} shellPlaneConfigured_=null
         * @reactive
         */
        shellPlaneConfigured_: null,
        /**
         * The field's team, `{total, up}`, from the team line's read, or `null` whenever that read has not
         * answered live: a field without an answer draws no marks.
         * @member {Object|null} team_=null
         * @reactive
         */
        team_: null,
        /**
         * Anchored at the top, so the block stays still while its lines come and go.
         * @member {Object} layout={ntype:'vbox',align:'center',pack:'start'}
         * @reactive
         */
        layout: {ntype: 'vbox', align: 'center', pack: 'start'},
        /**
         * @member {Object[]} items
         */
        items: [{
            ntype : 'container',
            cls   : ['fm-home-inner'],
            flex  : 'none',
            layout: {ntype: 'vbox', align: 'start'},
            items : [{
                ntype: 'component',
                tag  : 'p',
                cls  : ['fm-home-eyebrow'],
                text : 'Neo Agent OS'
            }, {
                ntype    : 'component',
                tag      : 'h1',
                cls      : ['fm-home-h1'],
                reference: 'lead',
                text     : PRODUCT_LINE
            }, {
                ntype    : 'component',
                tag      : 'p',
                cls      : ['fm-home-lede'],
                reference: 'lede',
                text     : 'Your fleet\'s state at a glance, its work streaming in real time, commanded from the cockpit, not a terminal.'
            }, {
                ntype    : 'component',
                tag      : 'p',
                cls      : ['fm-home-plane'],
                hidden   : true,
                reference: 'plane-line',
                text     : ''
            }, {
                ntype    : 'container',
                cls      : ['fm-home-doors'],
                layout   : {ntype: 'vbox', align: 'start'},
                reference: 'doors',
                items    : [
                    door('fa-solid fa-satellite-dish', '/fleet',       'What is the team doing?'),
                    door('fa-solid fa-circle-nodes',   '/observatory', 'What does the organism know?'),
                    door('fa-solid fa-server',         '/system',      'Is the plane healing itself?')
                ]
            }, {
                module   : Button,
                cls      : ['agent-button', 'agent-submit-button', 'fm-home-connect'],
                handler  : 'onAttachPlane',
                hidden   : true,
                reference: 'connect-plane',
                text     : 'Connect a plane'
            }]
        }]
    }

    /**
     * @summary The team line's words from the roster surface: who is up, once the read answers live;
     * before that, and whenever it cannot answer, the read's own state, so an unanswered roster never
     * reads as an empty team. "Up" is the roster's online and idle tiers (`FleetAgent.tierRankFor`).
     * @param {Object}      facts
     * @param {String}      facts.adapterState   `cold` · `live` · `stale`
     * @param {String|null} facts.degradedReason
     * @param {String[]}    facts.states         The roster rows' session states
     * @returns {{answered: Boolean, team: Object|null, text: String}} `team` is the field's `{total, up}`, only
     * once the read answers
     */
    static teamLine({adapterState, degradedReason, states}) {
        if (adapterState === 'cold') {
            return {answered: false, team: null, text: 'No word from the team yet'}
        }

        if (adapterState !== 'live' || degradedReason) {
            return {answered: false, team: null, text: 'Lost touch with the team'}
        }

        const
            total = states.length,
            up    = states.filter(state => FleetAgent.tierRankFor(state) < 2).length;

        return {answered: true, team: {total, up}, text: total ? `${up} of ${total} ${total === 1 ? 'agent' : 'agents'} up` : 'No agents yet'}
    }

    /**
     * @summary Renders whatever the provider already holds: Home is built before the first read lands. The
     * field joins behind the hero wherever a canvas worker runs.
     * @param {...*} args
     */
    onConstructed(...args) {
        const me = this;

        super.onConstructed(...args);

        if (Neo.config.useCanvasWorker && !Neo.config.unitTestMode) {
            me.insert(0, {module: HomeCanvas, reference: 'canvas', team: me.team})
        }

        me.applyState()
    }

    /** @param {...*} args */
    destroy(...args) {
        this.rosterStore?.un({load: this.applyState, recordChange: this.applyState, scope: this});
        super.destroy(...args)
    }

    /** @param {String} value @param {String} oldValue */
    afterSetGridAdapterState(value, oldValue) {
        this.isConstructed && this.applyState()
    }

    /** @param {String|null} value @param {String|null} oldValue */
    afterSetGridDegradedReason(value, oldValue) {
        this.isConstructed && this.applyState()
    }

    /** @param {String} value @param {String} oldValue */
    afterSetInstanceState(value, oldValue) {
        this.isConstructed && this.applyState()
    }

    /**
     * @summary Follows the roster: a reload and a row whose state changes both move the team line.
     * @param {AgentOS.store.FleetRoster|null} value
     * @param {AgentOS.store.FleetRoster|null} oldValue
     */
    afterSetRosterStore(value, oldValue) {
        oldValue?.un({load: this.applyState, recordChange: this.applyState, scope: this});
        value   ?.on({load: this.applyState, recordChange: this.applyState, scope: this});
        this.isConstructed && this.applyState()
    }

    /** @param {Boolean|null} value @param {Boolean|null} oldValue */
    afterSetShellPlaneConfigured(value, oldValue) {
        this.isConstructed && this.applyState()
    }

    /**
     * @summary The field follows the team line's read.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     */
    afterSetTeam(value, oldValue) {
        const canvas = this.getReference('canvas');

        canvas && (canvas.team = value)
    }

    /**
     * @summary Picks the reader. A packaged shell without a plane gets the product line, the lede and
     * *Connect a plane*. Everyone else gets the team line in the display slot, the plane line whenever
     * the chrome's verdict is not `ok`, and the doors. The field's team comes from the team line's read.
     */
    applyState() {
        const
            me       = this,
            firstRun = me.shellPlaneConfigured === false,
            state    = me.instanceState,
            word     = Object.hasOwn(INSTANCE_STATE_WORDS, state) ? INSTANCE_STATE_WORDS[state] : INSTANCE_STATE_WORDS.off,
            line     = firstRun ? null : Container.teamLine({
                adapterState  : me.gridAdapterState,
                degradedReason: me.gridDegradedReason,
                states        : me.rosterStore?.items.map(record => record.state) ?? []
            });

        me.getReference('lead').set({
            cls : line && !line.answered ? ['fm-home-h1', 'is-quiet'] : ['fm-home-h1'],
            text: line?.text ?? PRODUCT_LINE
        });

        me.getReference('lede').hidden          = !firstRun;
        me.getReference('connect-plane').hidden = !firstRun;
        me.getReference('doors').hidden         = firstRun;

        me.getReference('plane-line').set({hidden: firstRun || state === 'ok', text: `Plane ${word}`});

        me.team = line?.team ?? null
    }

    /**
     * @summary Hands a click anywhere on Home to the field.
     * @param {Object} data
     */
    onFieldClick(data) {
        this.getReference('canvas')?.onClick(data)
    }

    /**
     * @summary The pointer left Home: the field forgets it.
     * @param {Object} data
     */
    onFieldLeave(data) {
        this.getReference('canvas')?.onMouseLeave(data)
    }

    /**
     * @summary Hands a pointer move anywhere on Home to the field.
     * @param {Object} data
     */
    onFieldMove(data) {
        this.getReference('canvas')?.onMouseMove(data)
    }
}

export default Neo.setupClass(Container);
