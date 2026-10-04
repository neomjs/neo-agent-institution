import Button          from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import Container       from '../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import TextField       from '../../../../../node_modules/neo.mjs/src/form/field/Text.mjs';
import SeatGitIdentity from '../../../util/SeatGitIdentity.mjs';

/**
 * @class AgentOS.view.fleet.shared.GitIdentityContainer
 * @extends Neo.container.Base
 *
 * @summary The one row that says which identity a seat's commits carry, and repairs it (Clio's placement
 * on #524). Add mounts it inline only when the derivation fails, with the declaration open at once.
 * Detail's Configuration keeps it for every state, with one action per state: declare a failed
 * derivation, read a failed read again, change a working identity. Start's identity refusal points here.
 *
 * Like the Repositories card it changes nothing itself. It fires `declareGitIdentity` with the typed
 * pair, or `readGitIdentity` to retry a read that failed, and its owner runs the round-trip and sets
 * `identity` and `status` back.
 */
class GitIdentityContainer extends Container {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.shared.GitIdentityContainer'
         * @protected
         */
        className: 'AgentOS.view.fleet.shared.GitIdentityContainer',
        /**
         * @member {String} ntype='fm-git-identity'
         * @protected
         */
        ntype: 'fm-git-identity',
        /**
         * @member {String[]} baseCls=['fm-git-identity']
         */
        baseCls: ['fm-git-identity'],
        /**
         * The actions wear the shared chip skin (fleet/mailbox/Chips.scss), which has no view class of
         * its own, so it loads as a shared partial.
         * @member {String[]} additionalThemeFiles=['AgentOS.view.fleet.mailbox.Chips']
         */
        additionalThemeFiles: ['AgentOS.view.fleet.mailbox.Chips'],
        /**
         * The declaration toggled open by the repair action. Inline mode ignores it.
         * @member {Boolean} editing_=false
         * @reactive
         */
        editing_: false,
        /**
         * The seat's identity as the Fleet answers it (`{state, name?, email?, reason?}`, see
         * {@link AgentOS.util.SeatGitIdentity}); `null` before a read.
         * @member {Object|null} identity_=null
         * @reactive
         */
        identity_: null,
        /**
         * Add's mode: the declaration shows at once for `missing` and `mismatch`. Detail's mode (`false`)
         * keeps it behind the state's one action. In both, `unknown` offers only "Read again": declaring
         * over a read that failed would mask a transient refusal.
         * @member {Boolean} inline_=false
         * @reactive
         */
        inline_: false,
        /**
         * @member {Object} layout={ntype:'vbox',align:'stretch'}
         * @reactive
         */
        layout: {ntype: 'vbox', align: 'stretch'},
        /**
         * Ephemeral round-trip feedback, `{state: 'idle'|'pending'|'rejected', reason}`: component
         * state, never definition data.
         * @member {Object} status_={state:'idle',reason:''}
         * @reactive
         */
        status_: {state: 'idle', reason: ''},
        /**
         * Heading · the state line · the repair action · the declaration · the retry · status line.
         * Skin in `GitIdentityContainer.scss`.
         * @member {Object[]} items
         */
        items: [{
            ntype: 'component',
            cls  : ['fm-git-identity-heading'],
            flex : 'none',
            text : 'Commit identity'
        }, {
            ntype    : 'component',
            cls      : ['fm-git-identity-line'],
            flex     : 'none',
            reference: 'identity-line'
        }, {
            module   : Button,
            cls      : ['fm-chip', 'fm-git-identity-repair'],
            flex     : 'none',
            handler  : 'up.onRepairClick',
            reference: 'identity-repair'
        }, {
            ntype    : 'container',
            cls      : ['fm-git-identity-fields'],
            flex     : 'none',
            hidden   : true,
            layout   : {ntype: 'vbox', align: 'stretch'},
            reference: 'identity-fields',

            items: [{
                module         : TextField,
                flex           : 'none',
                labelPosition  : 'inline',
                labelText      : 'Name its commits carry',
                name           : 'gitName',
                reference      : 'field-git-name'
            }, {
                module         : TextField,
                flex           : 'none',
                labelPosition  : 'inline',
                labelText      : 'Email its commits carry',
                name           : 'gitEmail',
                placeholderText: 'name@example.com',
                reference      : 'field-git-email'
            }, {
                module   : Button,
                cls      : ['fm-chip', 'fm-git-identity-save'],
                flex     : 'none',
                handler  : 'up.onSaveClick',
                reference: 'identity-save',
                text     : 'Save identity'
            }]
        }, {
            module   : Button,
            cls      : ['fm-chip', 'fm-git-identity-read'],
            flex     : 'none',
            handler  : 'up.onReadClick',
            hidden   : true,
            reference: 'identity-read',
            text     : 'Read again'
        }, {
            ntype    : 'component',
            cls      : ['fm-git-identity-status', 'is-idle'],
            flex     : 'none',
            reference: 'identity-status'
        }]
    }

    /**
     * @summary Render the first state, its declaration prefilled.
     * @param {...*} args
     */
    onConstructed(...args) {
        super.onConstructed(...args);
        this.fillFields();
        this.syncIdentity()
    }

    /**
     * Triggered after the editing config got changed
     * @param {Boolean} value
     * @param {Boolean} oldValue
     * @protected
     */
    afterSetEditing(value, oldValue) {
        if (oldValue !== undefined) {
            value && this.fillFields();
            this.syncIdentity()
        }
    }

    /**
     * Triggered after the identity config got changed: a new answer closes the declaration and clears
     * the last round-trip's feedback, so nothing shown belongs to an earlier answer.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetIdentity(value, oldValue) {
        if (oldValue !== undefined) {
            const me = this;

            me.set({editing: false, status: {state: 'idle', reason: ''}});
            me.fillFields();
            me.syncIdentity()
        }
    }

    /**
     * Triggered after the inline config got changed
     * @param {Boolean} value
     * @param {Boolean} oldValue
     * @protected
     */
    afterSetInline(value, oldValue) {
        oldValue !== undefined && this.syncIdentity()
    }

    /**
     * Triggered after the status config got changed
     * @param {Object} value
     * @param {Object} oldValue
     * @protected
     */
    afterSetStatus(value, oldValue) {
        oldValue !== undefined && this.syncIdentity()
    }

    /**
     * @summary Prefill the declaration with what the Fleet already knows: the declared or derived pair,
     * or a missing state's name.
     */
    fillFields() {
        const
            me       = this,
            identity = me.identity;

        me.getReference('field-git-name') .value = identity?.name  ?? '';
        me.getReference('field-git-email').value = identity?.email ?? ''
    }

    /**
     * @summary Whether the declaration shows: at once in Add for a failed derivation the operator can
     * repair by declaring, else only while the repair action holds it open.
     * @returns {Boolean}
     */
    isDeclarationOpen() {
        const {editing, identity, inline} = this;

        return inline ? identity?.state === 'missing' || identity?.state === 'mismatch' : editing
    }

    /**
     * @summary Render the state line, the actions and the feedback from the current configs.
     */
    syncIdentity() {
        const
            me       = this,
            identity = me.identity,
            state    = identity?.state ?? 'unread',
            open     = me.isDeclarationOpen(),
            pending  = me.status?.state === 'pending';

        me.getReference('identity-line').set({
            cls : ['fm-git-identity-line', `is-${state}`],
            text: SeatGitIdentity.describe(identity)
        });

        // one action per state: a failed read is read again, everything else toggles the declaration,
        // the way Edit connection toggles its options
        me.getReference('identity-repair').set({
            hidden: me.inline || state === 'unknown',
            text  : me.editing ? 'Close' : SeatGitIdentity.needsRepair(identity) ? 'Declare identity' : 'Change identity'
        });

        me.getReference('identity-fields').hidden = !open;
        me.getReference('identity-save').disabled = pending;
        me.getReference('identity-read').set({disabled: pending, hidden: state !== 'unknown'});

        me.getReference('identity-status').set({
            cls : ['fm-git-identity-status', `is-${me.status?.state ?? 'idle'}`],
            text: pending ? 'Saving…' : me.status?.reason ?? ''
        })
    }

    /** @summary Toggle the declaration open or closed. */
    onRepairClick() {
        this.editing = !this.editing
    }

    /** @summary Ask the owner to read the identity again. */
    onReadClick() {
        this.fire('readGitIdentity')
    }

    /** @summary Hand the typed pair to the owner, which declares it and sets the answer back. */
    onSaveClick() {
        const me = this;

        me.fire('declareGitIdentity', {
            gitEmail: me.getReference('field-git-email').value ?? '',
            gitName : me.getReference('field-git-name') .value ?? ''
        })
    }
}

export default Neo.setupClass(GitIdentityContainer);
