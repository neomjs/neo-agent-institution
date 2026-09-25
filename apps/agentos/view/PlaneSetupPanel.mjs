import Button    from '../../../node_modules/neo.mjs/src/button/Base.mjs';
import Panel     from '../../../node_modules/neo.mjs/src/container/Panel.mjs';
import TextField from '../../../node_modules/neo.mjs/src/form/field/Text.mjs';

/**
 * @summary The packaged shell's "connect to a plane" card: inline, dismissible, and never a gate — the
 * sample cockpit stays usable behind it, as the shell spec requires.
 *
 * `AgentOS.view.ViewportController#mountPlaneSetup` creates it only for a packaged shell with no
 * plane configured. Connecting hands the plane address to `attachPlane()`; Electron main then asks
 * for the PAT in its own window, checks it against the plane, stores it encrypted, and relaunches the
 * shell. No credential ever reaches this card, so every line it renders is plain `text`.
 * @class AgentOS.view.PlaneSetupPanel
 * @extends Neo.container.Panel
 */
class PlaneSetupPanel extends Panel {
    /**
     * The line each refusal from `attachPlane()` renders.
     * @member {Object} reasonText
     * @static
     */
    static reasonText = {
        canceled                : 'Canceled. Nothing was stored.',
        'encryption-unavailable': 'This Mac cannot store the PAT encrypted, so nothing was stored.',
        'invalid-plane-base'    : 'Use an https address, or http on this machine (127.0.0.1 or localhost).',
        'not-a-plane'           : 'That address is not a Neo plane. Nothing was stored.',
        rejected                : 'The plane refused that PAT. Nothing was stored.',
        unreachable             : 'No plane answered at that address.'
    }

    static config = {
        /**
         * @member {String} className='AgentOS.view.PlaneSetupPanel'
         * @protected
         */
        className: 'AgentOS.view.PlaneSetupPanel',
        /**
         * @member {String[]} cls=['agent-plane-setup']
         */
        cls: ['agent-plane-setup'],
        /**
         * @member {Object[]} headers
         */
        headers: [{
            dock : 'top',
            items: [{
                ntype: 'label',
                text : 'Connect this shell to a plane'
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
            ntype: 'component',
            cls  : ['agent-plane-setup-lede'],
            text : 'The cockpit shows sample data until it attaches to your team\'s plane. Your GitHub PAT is asked for in a separate window and stored encrypted on this Mac.'
        }, {
            ntype : 'container',
            cls   : ['agent-plane-setup-row'],
            layout: {ntype: 'hbox', align: 'end'},
            items : [{
                module   : TextField,
                flex     : 1,
                labelText: 'Plane address',
                reference: 'plane-base-field',
                value    : 'http://127.0.0.1:3102'
            }, {
                module   : Button,
                cls      : ['agent-plane-setup-connect'],
                handler  : 'up.onConnectClick',
                reference: 'connect-button',
                text     : 'Connect'
            }]
        }, {
            ntype    : 'component',
            cls      : ['agent-plane-setup-status'],
            reference: 'status-line',
            role     : 'status',
            text     : ''
        }]
    }

    /**
     * @summary Hands the plane address to the shell, then renders its verdict. On success the shell
     * relaunches, so the button stays disabled.
     * @returns {Promise<void>}
     */
    async onConnectClick() {
        const
            me     = this,
            button = me.getReference('connect-button'),
            status = me.getReference('status-line');

        button.disabled = true;
        status.text     = 'Enter your GitHub PAT in the window that opens.';

        const reply = await Promise.resolve(Neo.main?.addon?.ShellPlane?.attachPlane({
            planeBase: me.getReference('plane-base-field').value,
            windowId : me.windowId
        })).catch(() => null);

        if (me.isDestroyed) return;

        if (reply?.ok) {
            status.text = 'Connected. The shell restarts to attach.';
            return
        }

        button.disabled = false;
        status.text     = PlaneSetupPanel.reasonText[reply?.reason] || 'The plane could not be attached.'
    }

    /**
     * @summary Hides the card for this session; it returns on the next launch while no plane is set.
     */
    onDismissClick() {
        this.hidden = true
    }
}

export default Neo.setupClass(PlaneSetupPanel);
