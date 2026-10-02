import BasePanel        from '../../../../node_modules/neo.mjs/src/container/Panel.mjs';
import Button           from '../../../../node_modules/neo.mjs/src/button/Base.mjs';
import ConnectContainer from './ConnectContainer.mjs';
import CreateContainer  from './CreateContainer.mjs';

/**
 * @summary The cockpit's setup card — inline, dismissible, never a gate: the frame stays usable
 * behind it with honest unanswered states, as the shell spec requires. Two doors share the card's
 * head: **Create** projects the first-run recipe (a plane of your own on this machine), **Connect**
 * attaches a plane that exists. The card stores nothing: which door is open is this session's
 * choice, the recipe's steps are the vessel's fresh evaluation, and dismissing hides the card for
 * this session while the shell still needs a plane.
 *
 * `AgentOS.view.ViewportController#mountPlaneSetup` creates it for a packaged shell with no plane
 * configured and chooses the primary door from the shell's status; the banner, the switcher and
 * Home's doors bring it back on request.
 * @class AgentOS.view.setup.Panel
 * @extends Neo.container.Panel
 */
class Panel extends BasePanel {
    static config = {
        /**
         * @member {String} className='AgentOS.view.setup.Panel'
         * @protected
         */
        className: 'AgentOS.view.setup.Panel',
        /**
         * The Connect card's skin rule is the family's base rule; the doors add their own.
         * @member {String[]} cls=['agent-plane-setup','fm-setup-card']
         */
        cls: ['agent-plane-setup', 'fm-setup-card'],
        /**
         * The open door: `create` | `connect`.
         * @member {String} activeDoor_='create'
         * @reactive
         */
        activeDoor_: 'create',
        /**
         * @member {Object[]} headers
         */
        headers: [{
            dock : 'top',
            items: [{
                ntype: 'label',
                text : 'Set up your institution'
            }, {
                ntype    : 'container',
                cls      : ['fm-setup-doors'],
                layout   : {ntype: 'hbox', align: 'center'},
                reference: 'doors',
                items    : [{
                    module   : Button,
                    cls      : ['fm-setup-door-button'],
                    handler  : 'up.onCreateDoorClick',
                    pressed  : true,
                    reference: 'create-door-button',
                    text     : 'Create'
                }, {
                    module   : Button,
                    cls      : ['fm-setup-door-button'],
                    handler  : 'up.onConnectDoorClick',
                    reference: 'connect-door-button',
                    text     : 'Connect'
                }]
            }, '->', {
                module   : Button,
                cls      : ['agent-plane-setup-dismiss'],
                handler  : 'up.onDismissClick',
                reference: 'dismiss-button',
                text     : 'Not now'
            }]
        }],
        /**
         * @member {Object[]} items
         */
        items: [{
            module   : CreateContainer,
            // the door's events are the card's events to its owner (events do not bubble)
            listeners: {
                firstPersistence: 'up.onFirstPersistence',
                openMemories    : 'up.onOpenMemories'
            },
            reference: 'create-door'
        }, {
            module   : ConnectContainer,
            hidden   : true,
            reference: 'connect-door'
        }]
    }

    /**
     * @summary Relays the Create door's first persistence to the card's owner, which retires the
     * card from the primary slot.
     * @param {Object} data `{density, evaluation}`
     */
    onFirstPersistence(data) {
        this.fire('firstPersistence', data)
    }

    /**
     * @summary Relays the `done` row's action to the card's owner.
     * @param {Object} data
     */
    onOpenMemories(data) {
        this.fire('openMemories', data)
    }

    /**
     * @summary Shows one door, presses its button.
     * @param {String} value
     * @param {String} oldValue
     * @protected
     */
    afterSetActiveDoor(value, oldValue) {
        const me = this;

        if (!me.getReference('create-door')) return;

        me.getReference('create-door').hidden  = value !== 'create';
        me.getReference('connect-door').hidden = value !== 'connect';
        me.getReference('create-door-button').pressed  = value === 'create';
        me.getReference('connect-door-button').pressed = value === 'connect'
    }

    /**
     * @summary The doors are created after the config lands; apply the door once they exist.
     */
    onConstructed() {
        super.onConstructed();
        this.afterSetActiveDoor(this.activeDoor, null)
    }

    /**
     * @summary Opens the Connect door.
     */
    onConnectDoorClick() {
        this.activeDoor = 'connect'
    }

    /**
     * @summary Opens the Create door.
     */
    onCreateDoorClick() {
        this.activeDoor = 'create'
    }

    /**
     * @summary Hides the card for this session; it returns on the next launch while no plane is set,
     * and on request from the rail, the banner or Home's doors.
     */
    onDismissClick() {
        this.hidden = true
    }
}

export default Neo.setupClass(Panel);
