import Button        from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import FormContainer from '../../../../../node_modules/neo.mjs/src/form/Container.mjs';
import PasswordField from '../../../../../node_modules/neo.mjs/src/form/field/Password.mjs';
import TextField     from '../../../../../node_modules/neo.mjs/src/form/field/Text.mjs';
import AddAgentFlow  from '../../../util/AddAgentFlow.mjs';
import HarnessChoice from '../../../util/HarnessChoice.mjs';
import {displayBoundAgentOs} from './MenuList.mjs';

/**
 * The forges a seat's account can live on, in chip order.
 * @member {Object} FORGE_LABELS
 */
const FORGE_LABELS = Object.freeze({github: 'GitHub', gitlab: 'GitLab'});

/**
 * @class AgentOS.view.fleet.instances.AddAgentForm
 * @extends Neo.form.Container
 *
 * @summary The one add-agent form (design SSOT Lane D1). It serves the cockpit's rail and the
 * Accounts view. It collects the seat's account (its forge, a GitLab seat's instance, the username,
 * plus a personal access token for direct-browser ingress), the working repository, and the harness,
 * and submits through the Fleet Registry bridge. It renders the flow states from `AddAgentFlow`: `idle → validating → submitting →
 * readback-confirmed | gated | rejected`. The registry's canonical readback is the only success
 * truth.
 *
 * **The harness choice is a product first.** One chip per product (`HarnessChoice.products()`, read
 * from the Brain's catalog). *App* and *Command line* appear only for a product that ships both. The
 * stored value stays the catalog's harness type (`harnessType`), which the Fleet launches.
 *
 * **Mount-independent by design.** The form ends at the `agentDefinitionAccepted` event carrying the
 * validated public definition; the mounting owner writes the roster. It reads the injected instance
 * Store only to name the bound destination, never owning that Store or retaining credential state.
 *
 * **Credential boundary (the fleet credential matrix).** A direct-browser token lives in the password
 * field only as long as a submission needs it, and the field clears on every settle. A bridge marked
 * `credentialIngress: 'shell'` removes that field before mount and sends public intent only; the
 * native shell owns credential entry. Without a bridge the submit control is disabled with its
 * reason (CARD-CONTRACT controls rule: never hidden), state `gated`.
 */
class AddAgentForm extends FormContainer {
    static config = {
        /**
         * @member {String} className='AgentOS.view.fleet.instances.AddAgentForm'
         * @protected
         */
        className: 'AgentOS.view.fleet.instances.AddAgentForm',
        /**
         * @member {String} ntype='fm-add-agent-form'
         * @protected
         */
        ntype: 'fm-add-agent-form',
        /**
         * @member {String[]} baseCls=['fm-add-agent-form']
         */
        baseCls: ['fm-add-agent-form'],
        /**
         * The selector-chip primitive's skin (fleet/mailbox/Chips.scss) has no view class of its
         * own — the harness chips this form renders load it via the shared-partial mechanism, the
         * same way the dockdemo workspaces pull 'Neo.dashboard.Container'.
         * @member {String[]} additionalThemeFiles=['AgentOS.view.fleet.mailbox.Chips']
         */
        additionalThemeFiles: ['AgentOS.view.fleet.mailbox.Chips'],
        /**
         * Optional injected Fleet-Registry-bridge resolver — the DI seam (the injected-reader
         * discipline): owners and specs pass a function returning a bridge; null falls back to the
         * global `AgentOS.fleet.registryBridge` seam. The form never constructs a bridge.
         * @member {Function|null} bridgeResolver=null
         */
        bridgeResolver: null,
        /**
         * Whether the packaged shell owns the connected plane binding.
         * @member {Boolean} shellCustody_=false
         * @reactive
         */
        shellCustody_: false,
        /**
         * The attached shell plane base, or null when the shell runs its own Agent OS.
         * @member {String|null} shellPlaneBase_=null
         * @reactive
         */
        shellPlaneBase_: null,
        /**
         * The currently bound Agent OS profile and its provider-owned roster.
         * @member {String|null} boundProfileId_=null
         * @reactive
         */
        boundProfileId_: null,
        /**
         * The provider-owned instance roster used to resolve the bound destination label.
         * @member {Neo.data.Store|null} instanceStore_=null
         * @reactive
         */
        instanceStore_: null,
        /**
         * The flow's rendered lifecycle state — `{state, reason}` with state in the
         * {@link AgentOS.util.AddAgentFlow#ADD_AGENT_STATES flow vocabulary}.
         * Reactive: every transition re-renders the status line + control affordances.
         * @member {Object} flowStatus_={state:'idle',reason:''}
         * @reactive
         */
        flowStatus_: {state: 'idle', reason: ''},
        /**
         * The forge the seat's account lives on: `github` or `gitlab`. The instance field, the token
         * hint and the repository's shape follow it.
         * @member {String} forge_='github'
         * @reactive
         */
        forge_: 'github',
        /**
         * The selected harness type, the catalog's launched unit. The product and run-mode chips
         * both derive their selection from it, so there is one selection state.
         * @member {String|null} harnessType_=null
         * @reactive
         */
        harnessType_: null,
        /**
         * @member {Object} layout={ntype:'vbox',align:'stretch'}
         * @reactive
         */
        layout: {ntype: 'vbox', align: 'stretch'},
        /**
         * The form anatomy: pane head · the account (forge chips, the GitLab instance, username,
         * token) · working repository · harness (product chips, then App / Command line when the
         * product has both) · the action slot · status line. Geometry + skin in `AddAgentForm.scss`,
         * colors token-only.
         * @member {Object[]} items
         */
        // every row is flex:'none': the vbox default (grow 1) would distribute a stretched host's
        // height evenly across the anatomy — exactly the multi-hundred-px gaps the drawer showed.
        // Rows keep their natural height; a taller mount leaves quiet well space instead.
        items: [{
            ntype : 'container',
            cls   : ['fm-pane-head'],
            flex  : 'none',
            layout: {ntype: 'hbox', align: 'center', wrap: 'wrap'},
            items : [{ntype: 'component', cls: ['fm-pane-title'], text: 'Add an agent'}]
        }, {
            ntype    : 'component',
            cls      : ['fm-add-destination'],
            flex     : 'none',
            reference: 'destination-line'
        }, {
            ntype: 'component',
            cls  : ['fm-add-section'],
            flex : 'none',
            text : 'Account'
        }, {
            // the selected chip names the forge once; the token, instance and repository follow it
            ntype    : 'container',
            cls      : ['fm-add-forge-row'],
            flex     : 'none',
            layout   : {ntype: 'hbox', align: 'center', wrap: 'wrap'},
            reference: 'forge-row',

            items: Object.entries(FORGE_LABELS).map(([forge, text]) => ({
                module : Button,
                cls    : ['fm-chip'],
                text,
                handler: 'up.onForgeChipClick',
                forge
            }))
        }, {
            // a GitLab seat's PAT is presented to this origin only
            module         : TextField,
            clearable      : true,
            flex           : 'none',
            hidden         : true,
            labelPosition  : 'inline',
            labelText      : 'GitLab instance',
            name           : 'forgeHost',
            placeholderText: 'https://gitlab.example.com',
            reference      : 'field-forge-host',
            required       : true,
            value          : 'https://gitlab.com'
        }, {
            module         : TextField,
            clearable      : true,
            flex           : 'none',
            labelPosition  : 'inline',
            labelText      : 'Username',
            name           : 'githubUsername',
            placeholderText: 'neo-kimi-phoebe',
            reference      : 'field-username',
            required       : true
        }, {
            module         : PasswordField,
            clearable      : true,
            flex           : 'none',
            labelPosition  : 'inline',
            labelText      : 'Personal access token',
            name           : 'credential',
            placeholderText: 'github_pat_…',
            reference      : 'field-credential',
            required       : true
        }, {
            ntype    : 'component',
            cls      : ['fm-add-credential-help'],
            flex     : 'none',
            reference: 'credential-help',
            text     : 'This token gives the agent access to its repositories and the connected Agent OS.'
        }, {
            // the repo the seat's first Start clones and runs in
            module         : TextField,
            flex           : 'none',
            labelPosition  : 'inline',
            labelText      : 'Working repository',
            name           : 'repoSlug',
            placeholderText: 'owner/repo',
            reference      : 'field-repo',
            required       : true,
            value          : AddAgentFlow.DEFAULT_REPO_SLUG
        }, {
            ntype: 'component',
            cls  : ['fm-add-section'],
            flex : 'none',
            text : 'Harness'
        }, {
            // one chip per product in the Brain's catalog: a new product is one more chip here
            ntype    : 'container',
            cls      : ['fm-add-harness-row'],
            flex     : 'none',
            layout   : {ntype: 'hbox', align: 'center', wrap: 'wrap'},
            reference: 'product-row',

            items: HarnessChoice.products().map(entry => ({
                module : Button,
                cls    : ['fm-chip'],
                text   : entry.label,
                handler: 'up.onProductChipClick',
                product: entry.product
            }))
        }, {
            // App / Command line — shown only while the selected product ships both
            ntype    : 'container',
            cls      : ['fm-add-harness-row', 'fm-add-runs-as-row'],
            flex     : 'none',
            layout   : {ntype: 'hbox', align: 'center', wrap: 'wrap'},
            reference: 'runs-as-row',

            items: Object.entries(HarnessChoice.RUNS_AS_LABELS).map(([runsAs, text]) => ({
                module : Button,
                cls    : ['fm-chip'],
                text,
                handler: 'up.onRunsAsChipClick',
                runsAs
            }))
        }, {
            ntype : 'container',
            cls   : ['fm-pane-actions'],
            flex  : 'none',
            layout: {ntype: 'hbox', align: 'center'},

            items: [{
                module   : Button,
                cls      : ['fm-add-submit'],
                handler  : 'up.onSubmitClick',
                iconCls  : 'fa fa-lock',
                reference: 'submit-button',
                text     : 'Add agent'
            }]
        }, {
            ntype    : 'component',
            cls      : ['fm-add-status', 'is-idle'],
            flex     : 'none',
            reference: 'flow-status'
        }]
    }

    /**
     * @summary Seat the first product's harness, drop the token field for shell ingress, and probe
     * the bridge seam: an absent bridge renders the `gated` state up-front, so the operator learns
     * the affordance is closed before typing a token into it.
     * @param {...*} args
     */
    onConstructed(...args) {
        super.onConstructed(...args);

        const
            me          = this,
            bridge      = AddAgentFlow.resolveRegistryBridge(me.bridgeResolver),
            secretField = me.getReference('field-credential');

        me.harnessType ??= HarnessChoice.products()[0]?.defaultType ?? null;
        me.syncHarnessChips();

        if (AddAgentFlow.isShellCredentialIngress(bridge)) {
            // the shell owns credential entry (harness/credentialPrompt.mjs): the field goes, and its
            // help line names the next step
            secretField && me.remove(secretField);
            me.getReference('credential-help')?.set({text: 'On Add, the app asks once for this agent\'s token.'})
        }

        me.updateDestinationLine();
        me.syncForge();

        if (!bridge?.defineAgent) {
            me.flowStatus = {state: 'gated', reason: AddAgentFlow.FLEET_OFFLINE_REASON}
        }
    }

    /**
     * Triggered after the flowStatus config got changed — render the status line and the submit
     * affordance from the new state. Disabled-with-reason on `gated` and while `submitting`;
     * the reason text IS the status line (never a hidden control, never a tooltip-only fact).
     * @param {Object} value
     * @param {Object} oldValue
     * @protected
     */
    afterSetFlowStatus(value, oldValue) {
        if (oldValue === undefined) {
            return
        }

        const
            me     = this,
            status = me.getReference('flow-status'),
            submit = me.getReference('submit-button'),
            busy   = value.state === 'validating' || value.state === 'submitting';

        status?.set({
            cls : ['fm-add-status', `is-${value.state}`],
            text: value.reason || me.statusLineFor(value.state)
        });

        submit?.set({disabled: value.state === 'gated' || busy})
    }

    /**
     * Triggered after the forge config got changed — re-mark the forge chips and the fields that follow them.
     * @param {String} value
     * @param {String} oldValue
     * @protected
     */
    afterSetForge(value, oldValue) {
        oldValue !== undefined && this.syncForge()
    }

    /**
     * Triggered after the harnessType config got changed — re-mark both chip rows.
     * @param {String|null} value
     * @param {String|null} oldValue
     * @protected
     */
    afterSetHarnessType(value, oldValue) {
        oldValue !== undefined && this.syncHarnessChips()
    }

    /**
     * @summary Refresh the destination when the shell-custody mode changes.
     * @param {Boolean} value
     * @param {Boolean} oldValue
     * @protected
     */
    afterSetShellCustody(value, oldValue) {
        oldValue !== undefined && this.updateDestinationLine()
    }

    /**
     * @summary Refresh the destination when the attached shell plane changes.
     * @param {String|null} value
     * @param {String|null} oldValue
     * @protected
     */
    afterSetShellPlaneBase(value, oldValue) {
        oldValue !== undefined && this.updateDestinationLine()
    }

    /**
     * @summary Refresh the destination when the bound profile changes.
     * @param {String|null} value
     * @param {String|null} oldValue
     * @protected
     */
    afterSetBoundProfileId(value, oldValue) {
        oldValue !== undefined && this.updateDestinationLine()
    }

    /**
     * @summary Rebind the injected instance roster and refresh the read-only destination label.
     * @param {Neo.data.Store|null} value
     * @param {Neo.data.Store|null} oldValue
     * @protected
     */
    afterSetInstanceStore(value, oldValue) {
        const
            me        = this,
            listeners = {
                load        : me.onInstanceStoreChange,
                mutate      : me.onInstanceStoreChange,
                recordChange: me.onInstanceStoreChange,
                scope       : me
            };

        oldValue?.un(listeners);
        value?.on(listeners);
        this.updateDestinationLine()
    }

    /**
     * @summary Refresh the destination after the roster loads, mutates, or changes a record.
     * @protected
     */
    onInstanceStoreChange() {
        this.updateDestinationLine()
    }

    /**
     * @summary Render the current bound Agent OS destination without offering a target selector.
     */
    updateDestinationLine() {
        const
            me     = this,
            record = (me.boundProfileId && me.instanceStore?.get(me.boundProfileId)) || null,
            label  = displayBoundAgentOs({shellCustody: me.shellCustody, shellPlaneBase: me.shellPlaneBase, record}) ?? 'no instance';

        me.getReference('destination-line')?.set({text: `Agent OS: ${label}`})
    }

    /**
     * @summary Default operator-facing line per flow state, used when an outcome carries no reason.
     * An idle form says nothing: the fields name what they need.
     * @param {String} state
     * @returns {String}
     */
    statusLineFor(state) {
        return {
            validating          : 'Checking the definition…',
            submitting          : 'Adding the agent…',
            'readback-confirmed': 'Agent added.'
        }[state] ?? ''
    }

    /**
     * @summary Mark the selected forge chip, show the instance field only for GitLab, and let the token
     * and repository hints follow the forge. The default repository is a GitHub one, so a GitLab seat
     * starts from an empty field, and an empty field gets the default back on GitHub.
     */
    syncForge() {
        const
            me     = this,
            gitlab = me.forge === 'gitlab',
            host   = me.getReference('field-forge-host'),
            repo   = me.getReference('field-repo'),
            token  = me.getReference('field-credential');

        me.getReference('forge-row')?.items.forEach(chip => {
            chip[chip.forge === me.forge ? 'addCls' : 'removeCls']('is-selected')
        });

        if (host) host.hidden = !gitlab;
        if (token) token.placeholderText = gitlab ? 'glpat-…' : 'github_pat_…';

        if (repo) {
            repo.placeholderText = gitlab ? 'group/project' : 'owner/repo';

            if (gitlab && repo.value === AddAgentFlow.DEFAULT_REPO_SLUG) {
                repo.value = ''
            } else if (!gitlab && !repo.value) {
                repo.value = AddAgentFlow.DEFAULT_REPO_SLUG
            }
        }
    }

    /**
     * @summary Mark the selected product chip, and show the App / Command line row with its
     * selected run mode only while the product ships both.
     */
    syncHarnessChips() {
        const
            me      = this,
            choice  = HarnessChoice.choiceOf(me.harnessType),
            product = HarnessChoice.products().find(item => item.product === choice?.product),
            runsAs  = me.getReference('runs-as-row');

        me.getReference('product-row')?.items.forEach(chip => {
            chip[chip.product === choice?.product ? 'addCls' : 'removeCls']('is-selected')
        });

        if (runsAs) {
            runsAs.hidden = !product?.runsAs.length;

            runsAs.items.forEach(chip => {
                chip[chip.runsAs === choice?.runsAs ? 'addCls' : 'removeCls']('is-selected')
            })
        }
    }

    /**
     * @summary A forge chip selects the forge the seat's account lives on.
     * @param {Object} data
     */
    onForgeChipClick(data) {
        this.forge = data.component.forge
    }

    /**
     * @summary A product chip selects that product, keeping the current run mode when it has one.
     * @param {Object} data
     */
    onProductChipClick(data) {
        const me = this;

        me.harnessType = HarnessChoice.typeFor(data.component.product, HarnessChoice.choiceOf(me.harnessType)?.runsAs) ?? me.harnessType
    }

    /**
     * @summary An App / Command line chip selects the current product's type with that run mode.
     * @param {Object} data
     */
    onRunsAsChipClick(data) {
        const
            me     = this,
            choice = HarnessChoice.choiceOf(me.harnessType);

        if (choice) {
            me.harnessType = HarnessChoice.typeFor(choice.product, data.component.runsAs) ?? me.harnessType
        }
    }

    /**
     * @summary Drive one full flow round-trip: validate → submit → render the terminal outcome —
     * and clear the token field on EVERY settle path — the credential outlives no attempt.
     * An accepted readback fires `agentDefinitionAccepted` for the mounting owner's roster write.
     * @returns {Promise<void>}
     */
    async onSubmitClick() {
        const
            me         = this,
            values     = await me.getSubmitValues(),
            bridge     = AddAgentFlow.resolveRegistryBridge(me.bridgeResolver),
            shellOwned = AddAgentFlow.isShellCredentialIngress(bridge),
            payload    = AddAgentFlow.createDefineAgentIntent({
                credential    : values.credential,
                forge         : me.forge,
                forgeHost     : values.forgeHost,
                githubUsername: values.githubUsername,
                harnessType   : me.harnessType
            }, bridge);

        me.flowStatus = {state: 'validating', reason: ''};

        try {
            const validation = AddAgentFlow.validateDefinePayload(payload, {credentialRequired: !shellOwned});

            // an incomplete definition never renders `submitting` — nothing is in flight
            if (!validation.valid) {
                me.flowStatus = {state: 'rejected', reason: validation.reason};
                return
            }

            me.flowStatus = {state: 'submitting', reason: ''};

            const outcome = await AddAgentFlow.submitDefineAgent({
                bridgeResolver: me.bridgeResolver,
                payload       : {...payload, repoSlug: values.repoSlug}
            });

            me.flowStatus = {state: outcome.state, reason: outcome.reason};

            if (outcome.state === 'readback-confirmed') {
                me.fire('agentDefinitionAccepted', {agent: outcome.definition})
            }
        } finally {
            me.getReference('field-credential')?.reset('')
        }
    }

    /** @summary Remove the Store listener; the provider retains ownership of that Store. */
    destroy(...args) {
        this.instanceStore?.un({
            load        : this.onInstanceStoreChange,
            mutate      : this.onInstanceStoreChange,
            recordChange: this.onInstanceStoreChange,
            scope       : this
        });
        super.destroy(...args)
    }
}

export default Neo.setupClass(AddAgentForm);
