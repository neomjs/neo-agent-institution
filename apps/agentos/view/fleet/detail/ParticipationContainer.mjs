import Button        from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import Container     from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import Participation from '../../../util/Participation.mjs';

/**
 * @class AgentOS.view.fleet.detail.ParticipationContainer
 * @extends Neo.container.Base
 *
 * @summary Configuration's Participation group, beside the Seat group: the seat's participation as its identity node
 * records it ({@link AgentOS.util.Participation#lineOf}). The cockpit writes no participation, so the group has no
 * action control. On an attached plane it names the one plane-host command that fits the state, with the seat filled
 * in and where it runs, and offers it to copy; otherwise it says why there is none
 * ({@link AgentOS.util.Participation#instructionOf}).
 *
 * It changes nothing itself: its owner sets `facts` from the roster record and `planeBase` from the shell, and a new
 * roster read re-seats it.
 */
class ParticipationContainer extends Container {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.detail.ParticipationContainer'
         * @protected
         */
        className: 'AgentOS.view.fleet.detail.ParticipationContainer',
        /**
         * @member {String} ntype='fm-participation'
         * @protected
         */
        ntype: 'fm-participation',
        /**
         * A Configuration group, drawn like the Seat group (`ParticipationContainer.scss`).
         * @member {String[]} baseCls=['fm-participation']
         */
        baseCls: ['fm-participation'],
        /**
         * The roster record's participation facts: `{githubUsername, participationStatus, participationReason,
         * participationSince, participationRead}`; `null` without a record.
         * @member {Object|null} facts_=null
         * @reactive
         */
        facts_: null,
        /**
         * The plane the shell is attached to, or `null` for this machine: where the command runs.
         * @member {String|null} planeBase_=null
         * @reactive
         */
        planeBase_: null,
        /**
         * @member {Object} layout={ntype:'vbox',align:'stretch'}
         * @reactive
         */
        layout: {ntype: 'vbox', align: 'stretch'},
        /**
         * Heading · the state's line · the command · where it runs and Copy · the copy source.
         * @member {Object[]} items
         */
        items: [{
            ntype: 'component',
            cls  : ['fm-participation-heading'],
            flex : 'none',
            text : 'Participation'
        }, {
            ntype    : 'component',
            cls      : ['fm-participation-line'],
            flex     : 'none',
            reference: 'participation-line'
        }, {
            ntype    : 'component',
            cls      : ['fm-participation-command'],
            flex     : 'none',
            reference: 'participation-command'
        }, {
            ntype : 'container',
            cls   : ['fm-participation-foot'],
            flex  : 'none',
            layout: {ntype: 'hbox', align: 'center', wrap: 'wrap'},
            items : [
                {ntype: 'component', cls: ['fm-participation-place'], flex: 1, reference: 'participation-place'},
                {module: Button, cls: ['fm-chip', 'fm-participation-copy'], flex: 'none', handler: 'up.onCopyClick', reference: 'participation-copy', text: 'Copy'}
            ]
        }, {
            // the copy source: an inert field the Copy action selects, unseen and unfocusable
            ntype    : 'component',
            cls      : ['fm-participation-field'],
            reference: 'participation-field',
            vdom     : {tag: 'input', 'aria-hidden': true, readonly: true, tabIndex: -1, type: 'text', value: ''}
        }]
    }

    /** @param {...*} args */
    onConstructed(...args) {
        super.onConstructed(...args);
        this.sync()
    }

    /** @param {Object|null} value @param {Object|null} oldValue */
    afterSetFacts(value, oldValue) {
        oldValue !== undefined && this.sync()
    }

    /** @param {String|null} value @param {String|null} oldValue */
    afterSetPlaneBase(value, oldValue) {
        oldValue !== undefined && this.sync()
    }

    /**
     * @summary Render the line, the command, where it runs and the copy source from the current configs.
     */
    sync() {
        const
            me               = this,
            {command, place} = Participation.instructionOf(me.facts, me.planeBase),
            field            = me.getReference('participation-field');

        me.getReference('participation-line').text   = Participation.lineOf(me.facts) ?? '';
        me.getReference('participation-command').set({hidden: !command, text: command ?? ''});
        me.getReference('participation-place').text  = place ?? '';
        me.getReference('participation-copy').hidden = !command;

        field.vdom.value = command ?? '';
        field.update()
    }

    /**
     * @summary The Copy action: the command goes to the clipboard through the main thread's selection of the unseen
     * field, and the focus returns to the action.
     * @param {Object} data The click; `detail` is 0 where the keyboard pressed the action
     */
    async onCopyClick(data) {
        const me = this, copy = me.getReference('participation-copy'), field = me.getReference('participation-field'), {windowId} = me;

        if (field.vdom.value) {
            await Neo.main.DomAccess.selectNode({id: field.id, windowId});
            await Neo.main.DomAccess.execCommand({command: 'copy', windowId});
            copy.focus(copy.id, false, true, data?.detail ? 'pointer' : 'keyboard')
        }
    }
}

export default Neo.setupClass(ParticipationContainer);
