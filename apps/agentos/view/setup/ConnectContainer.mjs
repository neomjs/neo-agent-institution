import Button    from '../../../../node_modules/neo.mjs/src/button/Base.mjs';
import Container from '../../../../node_modules/neo.mjs/src/container/Base.mjs';
import TextField from '../../../../node_modules/neo.mjs/src/form/field/Text.mjs';

/**
 * @summary The setup card's **Connect** door: a team member whose plane exists attaches with their
 * own PAT, and an operator brings a new one. Connecting hands the plane address to `attachPlane()`;
 * Electron main then asks for the PAT in its own window, checks it against the plane and puts it to
 * use: a running Fleet adopts it with no restart, and only a shell that cannot (no plane yet, or
 * another one) relaunches. A PAT put to use without a relaunch fires `connected`, so the card's owner
 * re-drives the cockpit. No credential ever reaches this door, so every line it renders is plain `text`.
 * @class AgentOS.view.setup.ConnectContainer
 * @extends Neo.container.Base
 */
class ConnectContainer extends Container {
    /**
     * The line each refusal from `attachPlane()` renders. A refusal that names two accounts reads
     * `accountsText()` instead.
     * @member {Object} reasonText
     * @static
     */
    static reasonText = {
        canceled                : 'Canceled. Nothing was stored.',
        'encryption-unavailable': 'This Mac cannot store the PAT encrypted, so nothing was stored.',
        'fleet-refused'         : 'The running Fleet could not adopt that PAT and keeps its current one. Nothing was stored.',
        'invalid-plane-base'    : 'Use an https address, or http on this machine (127.0.0.1 or localhost).',
        'no-identity'           : 'The plane accepted that PAT but named no identity for it. Nothing was stored.',
        'no-shell'              : 'Connecting a plane needs the installed Fleet Manager; in a browser, add the plane through the instance switcher.',
        'not-a-plane'           : 'That address is not a Neo plane. Nothing was stored.',
        rejected                : 'The plane refused that PAT. Nothing was stored.',
        unreachable             : 'No plane answered at that address.'
    }

    /**
     * @summary The line for a PAT the plane names as another account than the one this Fleet Manager
     * runs as: the shell refuses it rather than switch accounts.
     * @param {{identity: String, expectedIdentity: String}} reply
     * @returns {String}
     */
    static accountsText({identity, expectedIdentity}) {
        return `The plane names that PAT as ${identity}, not ${expectedIdentity}. Nothing was stored.`
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
     * @summary Hands the plane address to the shell, then renders its verdict. A shell that relaunches
     * keeps the button disabled; a PAT put to use without one fires `connected`.
     * @returns {Promise<void>}
     */
    async onConnectClick() {
        const
            me     = this,
            button = me.getReference('connect-button'),
            status = me.getReference('status-line');

        button.disabled = true;
        status.text     = 'Enter your GitHub or GitLab PAT in the window that opens. The plane checks it before anything changes.';

        const reply = await Promise.resolve(Neo.main?.addon?.ShellPlane?.attachPlane({
            planeBase: me.getReference('plane-base-field').value,
            windowId : me.windowId
        })).catch(() => null);

        if (me.isDestroyed) return;

        if (reply?.ok && reply.relaunching) {
            status.text = 'Connected. The shell restarts to attach.';
            return
        }

        button.disabled = false;

        if (reply?.ok) {
            status.text = 'Connected. The new PAT is in use, and the Fleet Manager keeps running.';
            me.fire('connected', {});
            return
        }

        status.text = reply?.identity && reply.expectedIdentity
            ? ConnectContainer.accountsText(reply)
            : ConnectContainer.reasonText[reply?.reason] || 'The plane could not be attached.'
    }
}

export default Neo.setupClass(ConnectContainer);
