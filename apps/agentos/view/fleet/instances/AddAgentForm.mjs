import Button               from '../../../../../node_modules/neo.mjs/src/button/Base.mjs';
import FormContainer        from '../../../../../node_modules/neo.mjs/src/form/Container.mjs';
import PasswordField        from '../../../../../node_modules/neo.mjs/src/form/field/Password.mjs';
import TextField            from '../../../../../node_modules/neo.mjs/src/form/field/Text.mjs';
import AddAgentFlow         from '../../../util/AddAgentFlow.mjs';
import HarnessChoice        from '../../../util/HarnessChoice.mjs';
import SeatGitIdentity      from '../../../util/SeatGitIdentity.mjs';
import GitIdentityContainer from '../shared/GitIdentityContainer.mjs';
import MemoryCandidateList  from './MemoryCandidateList.mjs';
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
 * **Existing memory is offered, never guessed.** Each time the form is shown, it asks the Fleet which
 * agents' memory the seat could continue (`AddAgentFlow.readMemoryCandidates`). Only the latest read
 * owns the answer, and a submission waits for the read in flight. Nothing found records
 * `memoryImport: 'none'` with no frame shown. Candidates show a frame after the token, one row each and
 * *Start with empty memory* as the last row: one candidate is preselected, several wait for a choice. A
 * check that could not answer says why in the operator's words, with *Retry*, and only the empty row,
 * chosen, adds the seat then. A fleet that cannot be reached shows no frame; submit asks it again.
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
 *
 * **The added seat's commit identity.** After the define stands, the form reads it
 * ({@link AgentOS.util.SeatGitIdentity}) and mounts the shared identity row only when the derivation
 * fails. A declaration goes through `configureAgent`, and the updated definition fires
 * `agentDefinitionAccepted` again, so the owner's roster holds it.
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
         * The operator's memory choice: a row's `source` (`'none'` for the empty row), or null.
         * @member {String|null} memoryChoice_=null
         * @reactive
         */
        memoryChoice_: null,
        /**
         * The Fleet's answer on existing memory, an {@link AgentOS.util.AddAgentFlow#readMemoryCandidates}
         * outcome; `{state:'reading'}` until it arrives.
         * @member {Object} memoryDiscovery_={state:'reading'}
         * @reactive
         */
        memoryDiscovery_: {state: 'reading'},
        /**
         * @member {Object} layout={ntype:'vbox',align:'stretch'}
         * @reactive
         */
        layout: {ntype: 'vbox', align: 'stretch'},
        /**
         * The form anatomy: pane head · the account (forge chips, the GitLab instance, username,
         * token) · existing memory, only when there is one to offer or the check failed · working
         * repository · harness (product chips, then App / Command line when the product has both) ·
         * the action slot · status line. Geometry + skin in `AddAgentForm.scss`, colors token-only.
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
            // a first-time operator never sees this frame: it shows only with a memory to offer, or
            // when the check could not answer
            ntype    : 'container',
            cls      : ['fm-add-memory'],
            flex     : 'none',
            hidden   : true,
            layout   : {ntype: 'vbox', align: 'stretch'},
            reference: 'memory-frame',

            items: [{
                ntype: 'component',
                cls  : ['fm-add-section'],
                flex : 'none',
                text : 'Existing memory'
            }, {
                ntype    : 'component',
                cls      : ['fm-add-memory-lead'],
                flex     : 'none',
                reference: 'memory-lead'
            }, {
                ntype    : 'component',
                cls      : ['fm-add-memory-note'],
                flex     : 'none',
                hidden   : true,
                reference: 'memory-note',
                text     : AddAgentFlow.MEMORY_COPY_NOTE
            }, {
                // the technical facts, never on a row or in the lead: the chosen candidate's folder, or
                // the producer's own words when the check could not answer
                ntype    : 'component',
                cls      : ['fm-add-memory-details'],
                flex     : 'none',
                hidden   : true,
                reference: 'memory-details',
                vdom     : {tag: 'details', cn: [{tag: 'summary', text: 'Details'}, {cls: ['fm-add-memory-source']}]}
            }, {
                ntype    : 'container',
                cls      : ['fm-add-memory-actions'],
                flex     : 'none',
                hidden   : true,
                layout   : {ntype: 'hbox', align: 'center', wrap: 'wrap'},
                reference: 'memory-actions',

                items: [{
                    module   : Button,
                    cls      : ['fm-chip'],
                    handler  : 'up.onMemoryRetryClick',
                    reference: 'memory-retry',
                    text     : 'Retry'
                }]
            }]
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
        }, {
            // the added seat's commit identity, mounted only when its derivation fails
            module   : GitIdentityContainer,
            flex     : 'none',
            hidden   : true,
            inline   : true,
            reference: 'git-identity'
        }]
    }

    /**
     * The id of the seat this form added last, whose commit identity the inline row repairs.
     * @member {String|null} addedAgentId=null
     * @protected
     */
    addedAgentId = null
    /**
     * The latest identity request, a read or a declaration. Only its answer may paint the row, so an
     * older reply of the same seat paints nothing.
     * @member {Number} identityRequest=0
     * @protected
     */
    identityRequest = 0
    /**
     * The read that owns the next memory answer while it is in flight, or null. A submission waits for
     * it, so a choice never rests on an answer a newer read is about to replace.
     * @member {Promise|null} memoryRead=null
     * @protected
     */
    memoryRead = null
    /**
     * The latest memory request. Only its answer may land, so a reply to an earlier read paints nothing
     * and consents to nothing.
     * @member {Number} memoryRequest=0
     * @protected
     */
    memoryRequest = 0

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

        me.getReference('git-identity').on({
            declareGitIdentity: me.onDeclareGitIdentity,
            readGitIdentity   : me.readGitIdentity,
            scope             : me
        });

        if (!bridge?.defineAgent) {
            me.flowStatus = {state: 'gated', reason: AddAgentFlow.FLEET_OFFLINE_REASON}
        }
    }

    /**
     * @summary Ask the Fleet for existing memory each time the form is shown. The form can be built at
     * shell boot, before the Fleet's bridge is wired, so an answer read at construction would be stale.
     * A form that leaves the screen gives up its read: an answer landing while it is away paints nothing.
     * @param {Boolean} value
     * @param {Boolean} oldValue
     * @protected
     */
    afterSetMounted(value, oldValue) {
        super.afterSetMounted(value, oldValue);

        const me = this;

        if (value) {
            AddAgentFlow.resolveRegistryBridge(me.bridgeResolver)?.defineAgent && me.readMemory()
        } else if (oldValue) {
            me.memoryRequest++;
            me.memoryRead = null
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
     * Triggered after the memoryChoice config got changed — mark the chosen row.
     * @param {String|null} value
     * @param {String|null} oldValue
     * @protected
     */
    afterSetMemoryChoice(value, oldValue) {
        oldValue !== undefined && this.syncMemoryChoice()
    }

    /**
     * Triggered after the memoryDiscovery config got changed — render the memory frame for the answer.
     * @param {Object} value
     * @param {Object} oldValue
     * @protected
     */
    afterSetMemoryDiscovery(value, oldValue) {
        oldValue !== undefined && this.syncMemoryFrame()
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
     * @summary Ask the Fleet which agents' memory this seat could continue. Only the latest request owns
     * the answer: a reply to an earlier read that lands late paints nothing and consents to nothing. The
     * frame stays as it is while a retry is in flight, and a submission waits for it (`memoryRead`).
     * @returns {Promise<void>} Settles once this request's answer has landed or been superseded.
     */
    readMemory() {
        const
            me      = this,
            request = ++me.memoryRequest,
            retry   = me.getReference('memory-retry');

        retry.disabled = true;

        // an answer that lands as the form is destroyed resumes after trap() could reject it
        return me.memoryRead = me.trap(AddAgentFlow.readMemoryCandidates({bridgeResolver: me.bridgeResolver})).then(discovery => {
            if (request === me.memoryRequest && !me.isDestroyed) {
                me.memoryRead      = null;
                me.memoryDiscovery = discovery;
                retry.disabled     = false
            }
        })
    }

    /**
     * @summary Render the memory frame for the Fleet's answer. It stays hidden while the first read runs
     * and when no memory exists. Otherwise it offers the answer's rows (`AddAgentFlow.memoryChoices`): the
     * candidates and the empty row, or, when the check could not answer, its reason with the empty row
     * and *Retry*. A new answer starts a new choice (`AddAgentFlow.preselectedMemory`).
     */
    syncMemoryFrame() {
        const
            me          = this,
            discovery   = me.memoryDiscovery,
            rows        = AddAgentFlow.memoryChoices(discovery),
            candidates  = discovery.state === 'candidates' ? discovery.candidates : [],
            frame       = me.getReference('memory-frame'),
            unavailable = discovery.state === 'unavailable',
            // built for the first answer with rows, so a form with no memory to offer carries no list
            list        = me.getReference('memory-list') ?? (rows.length > 0 ? frame.insert(2, {
                module   : MemoryCandidateList,
                flex     : 'none',
                listeners: {itemClick: 'up.onMemoryCandidateClick'},
                reference: 'memory-list'
            }) : null);

        me.memoryChoice = null;
        list && (list.store.data = rows);
        me.memoryChoice = AddAgentFlow.preselectedMemory(discovery);

        frame.hidden = rows.length === 0;
        frame[unavailable ? 'addCls' : 'removeCls']('is-unavailable');

        me.getReference('memory-lead').text = AddAgentFlow.memoryLead(discovery);

        me.getReference('memory-note').hidden    = candidates.length === 0;
        me.getReference('memory-actions').hidden = !unavailable;

        me.syncMemoryDetails()
    }

    /**
     * @summary Mark the operator's memory choice: the chosen row is selected, and Details follows it.
     */
    syncMemoryChoice() {
        const
            me     = this,
            list   = me.getReference('memory-list'),
            record = me.memoryChoice ? list.store.get(me.memoryChoice) : null;

        record ? list.selectItem(record) : list.selectionModel.deselectAll();
        me.syncMemoryDetails()
    }

    /**
     * @summary Details holds the technical facts the rows and the lead leave out
     * ({@link AgentOS.util.AddAgentFlow#memoryDetail}). With none, it hides.
     */
    syncMemoryDetails() {
        const
            me      = this,
            details = me.getReference('memory-details'),
            text    = AddAgentFlow.memoryDetail({discovery: me.memoryDiscovery, choice: me.memoryChoice});

        details.vdom.cn[1].text = text ?? '';
        details.hidden          = !text;
        details.update()
    }

    /**
     * @summary A row is the operator's choice: an agent's memory to continue, or the empty row.
     * @param {Object} data
     * @param {Object} data.record
     */
    onMemoryCandidateClick({record}) {
        this.memoryChoice = record.source
    }

    /**
     * @summary *Retry* asks the Fleet again after a check that could not answer.
     */
    onMemoryRetryClick() {
        this.readMemory()
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
     * An accepted readback fires `agentDefinitionAccepted` for the mounting owner's roster write, and
     * the next agent starts from a fresh memory choice.
     * @returns {Promise<void>}
     */
    async onSubmitClick() {
        const me = this;

        // the memory choice rests on the current answer: a fleet that could not be reached is asked
        // again, and a read in flight is awaited, even one a newer read replaces meanwhile
        me.memoryDiscovery.state === 'offline' && !me.memoryRead && me.readMemory();

        while (me.memoryRead) {
            await me.memoryRead
        }

        const
            values     = await me.getSubmitValues(),
            bridge     = AddAgentFlow.resolveRegistryBridge(me.bridgeResolver),
            shellOwned = AddAgentFlow.isShellCredentialIngress(bridge),
            memory     = AddAgentFlow.memoryImportFor({discovery: me.memoryDiscovery, choice: me.memoryChoice}),
            payload    = AddAgentFlow.createDefineAgentIntent({
                credential    : values.credential,
                forge         : me.forge,
                forgeHost     : values.forgeHost,
                githubUsername: values.githubUsername,
                harnessType   : me.harnessType,
                memoryImport  : memory.memoryImport
            }, bridge);

        me.flowStatus   = {state: 'validating', reason: ''};
        me.addedAgentId = null;
        me.identityRequest++;
        me.getReference('git-identity').set({hidden: true, identity: null});

        try {
            const validation = AddAgentFlow.validateDefinePayload(payload, {credentialRequired: !shellOwned});

            // an incomplete definition never renders `submitting` — nothing is in flight
            if (!validation.valid || !memory.valid) {
                me.flowStatus = {state: 'rejected', reason: validation.valid ? memory.reason : validation.reason};
                return
            }

            me.flowStatus = {state: 'submitting', reason: ''};

            const outcome = await AddAgentFlow.submitDefineAgent({
                bridgeResolver: me.bridgeResolver,
                payload       : {...payload, repoSlug: values.repoSlug}
            });

            me.flowStatus = {state: outcome.state, reason: outcome.reason};

            if (outcome.state === 'readback-confirmed') {
                // one agent's memory choice never carries over to the next agent
                me.syncMemoryFrame();
                me.fire('agentDefinitionAccepted', {agent: outcome.definition});
                me.addedAgentId = outcome.definition.id
            }
        } finally {
            me.getReference('field-credential')?.reset('')
        }

        // the define stands before the identity is read, so the read never holds or fails it
        me.addedAgentId && await me.readGitIdentity()
    }

    /**
     * @summary Read the added seat's commit identity, and mount the row only when the operator has
     * something to do: a derived or declared identity asks nothing new.
     * @returns {Promise<Object|null>} The Fleet's answer, or `null` when a newer request owns the row.
     */
    async readGitIdentity() {
        const
            me      = this,
            agentId = me.addedAgentId,
            request = ++me.identityRequest,
            row     = me.getReference('git-identity');

        // a retry shows it is reading, and Read again waits for the answer
        row.hidden || (row.status = {state: 'pending', reason: 'Reading…'});

        const identity = await SeatGitIdentity.read(AddAgentFlow.resolveRegistryBridge(me.bridgeResolver), agentId);

        if (request !== me.identityRequest || me.isDestroyed) {
            return null
        }

        row.set({hidden: !SeatGitIdentity.needsRepair(identity), identity});

        return identity
    }

    /**
     * @summary Declare the added seat's commit identity through `configureAgent`, then read it back: the
     * Fleet's answer, not the typed pair, is what the row shows.
     * @param {Object} data
     * @param {String} data.gitEmail
     * @param {String} data.gitName
     * @returns {Promise<void>}
     */
    async onDeclareGitIdentity({gitEmail, gitName}={}) {
        const
            me      = this,
            agentId = me.addedAgentId,
            row     = me.getReference('git-identity');

        if (!agentId) {
            return
        }

        // the declaration is the latest request now: a read still on its way paints nothing
        const request = ++me.identityRequest;

        row.status = {state: 'pending', reason: ''};

        const outcome = await SeatGitIdentity.declare(AddAgentFlow.resolveRegistryBridge(me.bridgeResolver), agentId, {gitEmail, gitName});

        if (request !== me.identityRequest || me.isDestroyed) {
            return
        }

        if (outcome.state === 'rejected') {
            row.status = {state: 'rejected', reason: outcome.reason};
            return
        }

        outcome.definition && me.fire('agentDefinitionAccepted', {agent: outcome.definition});

        const identity = await me.readGitIdentity();

        // the row closes on a usable answer, so the status line keeps what the seat commits as
        if (identity && !SeatGitIdentity.needsRepair(identity)) {
            me.flowStatus = {state: 'readback-confirmed', reason: `Agent added. ${SeatGitIdentity.describe(identity)}.`}
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
