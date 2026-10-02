import Button    from '../../../../node_modules/neo.mjs/src/button/Base.mjs';
import Container from '../../../../node_modules/neo.mjs/src/container/Base.mjs';
import TextField from '../../../../node_modules/neo.mjs/src/form/field/Text.mjs';

/**
 * @summary The setup card's **Connect** door: a team member whose plane exists attaches with their
 * own PAT. Connecting hands the plane address to `attachPlane()`; Electron main then asks for the
 * PAT in its own window, checks it against the plane, stores it encrypted, and relaunches the shell.
 * No credential ever reaches this door, so every line it renders is plain `text`.
 * @class AgentOS.view.setup.ConnectContainer
 * @extends Neo.container.Base
 */
class ConnectContainer extends Container {
    /**
     * The line each refusal from `attachPlane()` renders.
     * @member {Object} reasonText
     * @static
     */
    static reasonText = {
        canceled                : 'Canceled. Nothing was stored.',
        'encryption-unavailable': 'This Mac cannot store the PAT encrypted, so nothing was stored.',
        'invalid-plane-base'    : 'Use an https address, or http on this machine (127.0.0.1 or localhost).',
        'no-identity'           : 'The plane accepted that PAT but named no identity for it. Nothing was stored.',
        'no-shell'              : 'Connecting a plane needs the installed Fleet Manager; in a browser, add the plane through the instance switcher.',
        'not-a-plane'           : 'That address is not a Neo plane. Nothing was stored.',
        rejected                : 'The plane refused that PAT. Nothing was stored.',
        unreachable             : 'No plane answered at that address.'
    }

    static config = {
        /**
         * @member {String} className='AgentOS.view.setup.ConnectContainer'
         * @protected
         */
        className: 'AgentOS.view.setup.ConnectContainer',
        /**
         * @member {String[]} cls=['fm-setup-door','fm-setup-connect']
         */
        cls: ['fm-setup-door', 'fm-setup-connect'],
        /**
         * A column of content-sized blocks (see the Create door's layout note).
         * @member {Object} layout={ntype:'vbox'}
         */
        layout: {ntype: 'vbox'},
        /**
         * @member {Object[]} items
         */
        items: [{
            ntype: 'component',
            cls  : ['agent-plane-setup-lede'],
            text : 'A plane that already exists — your colleague\'s, or one you provisioned elsewhere. The cockpit shows what that plane answers; until then its data panes show unanswered or unavailable states. Your GitHub or GitLab PAT is asked for in a separate window and stored encrypted on this Mac.'
        }, {
            // sized to its content: the body's column would otherwise hand the row the leftover
            // height and its hidden overflow would clip the 32 px controls at the top
            ntype : 'container',
            cls   : ['agent-plane-setup-row'],
            flex  : 'none',
            layout: {ntype: 'hbox', align: 'center'},
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
        status.text     = 'Enter your GitHub or GitLab PAT in the window that opens.';

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
        status.text     = ConnectContainer.reasonText[reply?.reason] || 'The plane could not be attached.'
    }
}

export default Neo.setupClass(ConnectContainer);
