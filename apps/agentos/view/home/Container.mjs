import BaseContainer          from '../../../../node_modules/neo.mjs/src/container/Base.mjs';
import Button                 from '../../../../node_modules/neo.mjs/src/button/Base.mjs';
import {INSTANCE_STATE_WORDS} from '../fleet/instances/SwitcherButton.mjs';

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
 * where do I go?": the plane line speaks only when the plane is not connected, with its own door to
 * System, and one door leads to each view. For a first-time operator in a packaged shell without a plane it says what FM is and
 * offers one action, *Connect a plane*, with nothing that reads as fleet state.
 *
 * @summary Binds the Viewport provider's `instanceState`, the chrome switcher's own connection
 * verdict and vocabulary, and `shellPlaneConfigured`, which the ViewportController publishes from the
 * shell's plane status (`false` only for a packaged shell without a plane).
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
            instanceState       : data => data.instanceState,
            shellPlaneConfigured: data => data.shellPlaneConfigured
        },
        /**
         * The chrome's connection verdict for the bound instance: `ok` · `limited` · `off` · `starting`.
         * @member {String} instanceState_='off'
         * @reactive
         */
        instanceState_: 'off',
        /**
         * `false` for a packaged shell without a plane, `true` for one with a plane, `null` outside a shell.
         * @member {Boolean|null} shellPlaneConfigured_=null
         * @reactive
         */
        shellPlaneConfigured_: null,
        /**
         * @member {Object} layout={ntype:'vbox',align:'center',pack:'center'}
         * @reactive
         */
        layout: {ntype: 'vbox', align: 'center', pack: 'center'},
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
                ntype: 'component',
                tag  : 'h1',
                cls  : ['fm-home-h1'],
                text : 'Mission control for a cross-model AI engineering team.'
            }, {
                ntype: 'component',
                tag  : 'p',
                cls  : ['fm-home-lede'],
                text : 'Your fleet\'s state at a glance, its work streaming in real time, commanded from the cockpit, not a terminal.'
            }, {
                ntype    : 'container',
                cls      : ['fm-home-plane'],
                flex     : 'none',
                hidden   : true,
                layout   : {ntype: 'hbox', align: 'center'},
                reference: 'plane-line',
                items    : [{
                    ntype    : 'component',
                    tag      : 'span',
                    cls      : ['fm-home-plane-word'],
                    reference: 'plane-word',
                    text     : ''
                }, {
                    module: Button,
                    cls   : ['agent-button', 'fm-home-plane-door'],
                    route : '/system',
                    text  : 'Open System'
                }]
            }, {
                ntype    : 'container',
                cls      : ['fm-home-doors'],
                layout   : {ntype: 'hbox', align: 'stretch', wrap: 'wrap'},
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
     * @summary Renders whatever the provider already holds: Home is built before the first read lands.
     * @param {...*} args
     */
    onConstructed(...args) {
        super.onConstructed(...args);
        this.applyState()
    }

    /** @param {String} value @param {String} oldValue */
    afterSetInstanceState(value, oldValue) {
        this.isConstructed && this.applyState()
    }

    /** @param {Boolean|null} value @param {Boolean|null} oldValue */
    afterSetShellPlaneConfigured(value, oldValue) {
        this.isConstructed && this.applyState()
    }

    /**
     * @summary Picks the reader: a packaged shell without a plane gets *Connect a plane* and nothing
     * else; everyone else gets the doors, and the plane line whenever the chrome's verdict is not `ok`.
     */
    applyState() {
        const
            me       = this,
            state    = me.instanceState,
            firstRun = me.shellPlaneConfigured === false,
            word     = Object.hasOwn(INSTANCE_STATE_WORDS, state) ? INSTANCE_STATE_WORDS[state] : INSTANCE_STATE_WORDS.off;

        me.getReference('connect-plane').hidden = !firstRun;
        me.getReference('doors').hidden         = firstRun;
        me.getReference('plane-line').hidden    = firstRun || state === 'ok';
        me.getReference('plane-word').text      = `Plane ${word}`
    }
}

export default Neo.setupClass(Container);
