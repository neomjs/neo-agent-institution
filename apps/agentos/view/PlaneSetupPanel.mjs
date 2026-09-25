import Button    from '../../../node_modules/neo.mjs/src/button/Base.mjs';
import Panel     from '../../../node_modules/neo.mjs/src/container/Panel.mjs';
import TextField from '../../../node_modules/neo.mjs/src/form/field/Text.mjs';

/**
 * @summary The packaged shell's "connect to a plane" card: inline, dismissible, and never a gate — the
 * sample cockpit stays usable behind it, as the shell spec requires.
 *
 * It shows only in a packaged shell with no plane configured, read once from
 * `Neo.main.addon.ShellPlane.planeStatus()`, so a browser build or a configured shell never renders
 * it. Connecting hands the plane address to `attachPlane()`; Electron main then asks for the PAT in its
 * own window, checks it against the plane, stores it encrypted, and relaunches the shell. No credential
 * ever reaches this card, so every line it renders is plain `text`.
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
                handler  : 'up.onDismissClick',
                reference: 'dismiss-button',
                text     : 'Not now'
            }]
        }],
        /**
         * Hidden until the shell reports a packaged boot with no plane configured.
         * @member {Boolean} hidden=true
         * @reactive
         */
        hidden: true,
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
     * Whether the one status read has started.
     * @member {Boolean} planeStatusRead=false
     * @protected
     */
    planeStatusRead = false

    /**
     * Triggered after the windowId config got changed. The addon remotes need a window, so the one
     * status read starts here.
     * @param {Number|null} value
     * @param {Number|null} oldValue
     * @protected
     */
    afterSetWindowId(value, oldValue) {
        super.afterSetWindowId(value, oldValue);

        if (value && !this.planeStatusRead) {
            this.planeStatusRead = true;
            this.readPlaneStatus()
        }
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

    /**
     * @summary Reads the shell's plane status once and shows the card only for a packaged shell with no
     * plane configured. A failed read or a missing shell leaves it hidden.
     * @returns {Promise<void>}
     */
    async readPlaneStatus() {
        const status = await Promise.resolve(Neo.main?.addon?.ShellPlane?.planeStatus({windowId: this.windowId})).catch(() => null);

        if (!this.isDestroyed) {
            this.hidden = !(status?.available && status.packaged && !status.configured)
        }
    }
}

export default Neo.setupClass(PlaneSetupPanel);
