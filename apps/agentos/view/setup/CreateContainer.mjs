import Button      from '../../../../node_modules/neo.mjs/src/button/Base.mjs';
import Container   from '../../../../node_modules/neo.mjs/src/container/Base.mjs';
import SetupSteps  from '../../store/SetupSteps.mjs';
import StepList    from './StepList.mjs';
import {actionFor} from './StepList.mjs';
import TextArea    from '../../../../node_modules/neo.mjs/src/form/field/TextArea.mjs';

const GiB = 1073741824;

/**
 * @summary Words a byte count as GiB with one decimal; a missing count reads as such.
 * @param {*} bytes
 * @returns {String}
 */
export const gibText = bytes => Number.isFinite(bytes) ? `${(bytes / GiB).toFixed(1)} GiB` : 'not measured';

/**
 * @summary The CLI's own command, for a served cockpit without a vessel: the operator runs it on the
 * host and pastes its `--json` into the card, which projects it through the same list.
 * @type {String}
 */
export const CLI_COMMAND = 'node ai/scripts/setup/firstRun.mjs --json';

/**
 * @summary A row's question-side word for one preset, from the placement step's verdicts: which
 * list the preset sits in and the recipe's reason for it.
 * @param {Object|null} placement The placement step's `{recommended, possible, refused}`
 * @param {String} presetId
 * @returns {{verdict: String, reason: String, margins: Object|null}} `margins` is the row's `{host, guest}`
 */
export function presetVerdict(placement, presetId) {
    for (const verdict of ['recommended', 'possible', 'refused']) {
        const row = placement?.[verdict]?.find(entry => entry.id === presetId);

        if (row) {
            return {verdict, reason: row.reason ?? '', margins: row.margins ?? null}
        }
    }

    return {verdict: 'unknown', reason: 'the placement step has not answered', margins: null}
}

/**
 * @summary The density of one completed run — the counting definition, not a measurement: a decision
 * is one answered question (a consent with an answer) or one consent to an effect (an accepted
 * receipt); a manual action is a step whose action was an operator instruction (an effect the
 * vessel could not run itself). Placement is defaulted, never decided, unless the advanced fold
 * was opened.
 * @param {Object|null} evaluation
 * @param {Number} manualActions The instructions the door handed the operator this session
 * @returns {{decisions: Number, manualActions: Number}}
 */
export function countDensity(evaluation, manualActions = 0) {
    const steps = evaluation?.steps ?? [];

    return {
        decisions: steps.filter(step =>
            (step.kind === 'question' && step.status === 'ok' && step.answer !== null && step.answer !== undefined) ||
            (step.kind === 'effect' && step.receipt === 'accepted')
        ).length,
        manualActions
    }
}

/**
 * @summary The setup card's **Create** door: the first-run recipe projected inline. Every row is the
 * vessel's fresh evaluation for the bound target (the CLI's `--json` shape); the door stores
 * nothing, remembers no "completed" bit, and sends every action to main as a request whose reply
 * is a fresh evaluation. The three questions sit above the step list; the quiet confirmation is
 * the `done` step's own text at first persistence. Without a shell the door shows the CLI's command
 * and projects a pasted evaluation through the same list.
 * @class AgentOS.view.setup.CreateContainer
 * @extends Neo.container.Base
 */
class CreateContainer extends Container {
    static config = {
        /**
         * @member {String} className='AgentOS.view.setup.CreateContainer'
         * @protected
         */
        className: 'AgentOS.view.setup.CreateContainer',
        /**
         * @member {String[]} cls=['fm-setup-door','fm-setup-create']
         */
        cls: ['fm-setup-door', 'fm-setup-create'],
        /**
         * A column whose blocks are sized to their content: the engine's `align: 'stretch'` would
         * hand every block `flex: 1` inline, so the lede would take the leftover height and the rows
         * and the list would be squeezed behind their hidden overflow. The door scrolls instead.
         * @member {Object} layout={ntype:'vbox'}
         */
        layout: {ntype: 'vbox'},
        /**
         * The last evaluation main answered (`{runId, recordPath, recipeVersion, target, binding,
         * bindingReason, steps, terminal}`), or the pasted one in a served cockpit.
         * @member {Object|null} evaluation_=null
         * @reactive
         */
        evaluation_: null,
        /**
         * The placement probe's JSON for this machine.
         * @member {Object|null} probe_=null
         * @reactive
         */
        probe_: null,
        /**
         * The preset table, as main holds it.
         * @member {Object[]|null} presets_=null
         * @reactive
         */
        presets_: null,
        /**
         * Whether a shell answers the setup channels: `null` until the first call lands, then
         * `true` (the vessel) or `false` (a served cockpit, no vessel).
         * @member {Boolean|null} shellAvailable_=null
         * @reactive
         */
        shellAvailable_: null,
        /**
         * Instructions handed to the operator this session (an effect main could not run).
         * @member {Number} manualActions=0
         */
        manualActions: 0,
        /**
         * @member {Object[]} items
         */
        items: [{
            ntype    : 'component',
            cls      : ['agent-plane-setup-lede'],
            flex     : 'none',
            reference: 'lede',
            text     : 'A plane of your own on this machine: Docker, one inference preset, your GitHub or GitLab PAT. Nothing is written until you say so, each step says what it observed, and the frame stays usable behind this card.'
        }, {
            // the served cockpit's path: the CLI's command and a field for its --json
            ntype    : 'container',
            cls      : ['fm-setup-served'],
            flex     : 'none',
            hidden   : true,
            layout   : {ntype: 'vbox'},
            reference: 'served',
            items    : [{
                ntype: 'component',
                cls  : ['fm-setup-served-line'],
                text : 'This cockpit is served without a vessel, so it cannot run the recipe. Run it on the host and paste its output here; the card projects it the same way.'
            }, {
                ntype: 'component',
                cls  : ['fm-setup-served-command'],
                tag  : 'code',
                text : CLI_COMMAND
            }, {
                module   : TextArea,
                cls      : ['fm-setup-served-json'],
                labelText: 'The command\'s JSON',
                reference: 'pasted-json'
            }, {
                module   : Button,
                cls      : ['agent-plane-setup-connect', 'fm-setup-project-button'],
                handler  : 'up.onProjectPastedClick',
                reference: 'project-button',
                text     : 'Project'
            }]
        }, {
            ntype    : 'container',
            cls      : ['fm-setup-questions'],
            flex     : 'none',
            layout   : {ntype: 'vbox'},
            reference: 'questions',
            items    : [{
                ntype : 'container',
                cls   : ['fm-setup-q'],
                flex  : 'none',
                layout: {ntype: 'hbox', align: 'start'},
                items : [
                    {ntype: 'component', cls: ['fm-setup-q-key'], text: 'placement'},
                    {
                        // the budgets, then the frame the three verdicts answer
                        ntype : 'container',
                        cls   : ['fm-setup-placement'],
                        flex  : 1,
                        layout: {ntype: 'vbox'},
                        items : [
                            {ntype: 'component', cls: ['fm-setup-budget'],         flex: 'none', reference: 'budget-line',    text: 'not probed yet'},
                            {ntype: 'component', cls: ['fm-setup-placement-line'], flex: 'none', reference: 'placement-line', text: ''}
                        ]
                    }
                ]
            }, {
                ntype : 'container',
                cls   : ['fm-setup-q'],
                flex  : 'none',
                layout: {ntype: 'hbox', align: 'start'},
                items : [
                    {ntype: 'component', cls: ['fm-setup-q-key'], text: 'preset'},
                    {ntype: 'container', cls: ['fm-setup-presets'], flex: 1, layout: {ntype: 'hbox', align: 'stretch'}, reference: 'presets', items: []}
                ]
            }, {
                ntype : 'container',
                cls   : ['fm-setup-q'],
                flex  : 'none',
                layout: {ntype: 'hbox', align: 'center'},
                items : [
                    {ntype: 'component', cls: ['fm-setup-q-key'], text: 'plane credential'},
                    {module: Button, cls: ['agent-plane-setup-connect', 'fm-setup-credential-button'], handler: 'up.onCredentialClick', reference: 'credential-button', text: 'Open the credential window'},
                    {ntype: 'component', cls: ['fm-setup-q-note'], reference: 'credential-line', text: 'the PAT is entered in the vessel\'s own window and kept as an owner-only file; this card only ever shows its path'}
                ]
            }, {
                ntype : 'container',
                cls   : ['fm-setup-q'],
                flex  : 'none',
                layout: {ntype: 'hbox', align: 'start'},
                items : [
                    {ntype: 'component', cls: ['fm-setup-q-key'], text: 'provider key'},
                    {ntype: 'component', cls: ['fm-setup-q-note'], reference: 'provider-key-line', text: 'decided by the preset'}
                ]
            }, {
                ntype : 'container',
                cls   : ['fm-setup-q'],
                flex  : 'none',
                layout: {ntype: 'hbox', align: 'start'},
                items : [
                    {ntype: 'component', cls: ['fm-setup-q-key'], text: 'advanced'},
                    {ntype: 'component', cls: ['fm-setup-q-note'], reference: 'advanced-line', text: 'folded: defaults apply'}
                ]
            }]
        }, {
            module   : StepList,
            flex     : 'none',
            reference: 'step-list',
            listeners: {itemClick: 'up.onStepClick'}
        }, {
            ntype    : 'component',
            cls      : ['agent-plane-setup-status'],
            flex     : 'none',
            reference: 'status-line',
            role     : 'status',
            text     : ''
        }, {
            ntype    : 'component',
            cls      : ['fm-setup-quiet'],
            flex     : 'none',
            hidden   : true,
            reference: 'quiet-line',
            text     : ''
        }]
    }

    /**
     * @summary The door owns its projection store, seats it on the list once the items exist, and
     * asks for the first evaluation.
     */
    onConstructed() {
        super.onConstructed();

        const me = this;

        me.store = Neo.create(SetupSteps, {});
        me.getReference('step-list').store = me.store;
        me.refresh()
    }

    /**
     * @summary The store dies with the door.
     * @param {...*} args
     */
    destroy(...args) {
        this.store?.destroy();
        this.store = null;
        super.destroy(...args)
    }

    /**
     * @summary The shell's setup remotes, or `null` in a worker without the addon.
     * @returns {Object|null}
     * @protected
     */
    get shell() {
        return Neo.main?.addon?.ShellPlane ?? null
    }

    /**
     * @summary One remote call with the window id in the envelope; a thrown call reads as a refusal.
     * @param {String} name
     * @param {Object} [request={}]
     * @returns {Promise<Object>}
     * @protected
     */
    async callShell(name, request = {}) {
        const shell = this.shell;

        if (!shell?.[name]) {
            return {ok: false, reason: 'no-shell'}
        }

        return Promise.resolve(shell[name]({...request, windowId: this.windowId})).catch(error => ({ok: false, reason: error?.message ?? 'the shell did not answer'}))
    }

    /**
     * @summary Asks main for the evaluation, the probe and the presets in one go, then projects
     * them. Without a shell the door switches to the served path.
     * @returns {Promise<void>}
     */
    async refresh() {
        const
            me                            = this,
            [evaluation, probe, presets]  = await Promise.all([me.callShell('setupEvaluate'), me.callShell('setupProbe'), me.callShell('setupPresets')]);

        if (me.isDestroyed) return;

        if (evaluation.reason === 'no-shell') {
            me.shellAvailable = false;
            return
        }

        me.set({
            presets       : presets.ok ? presets.presets : null,
            probe         : probe.ok ? probe.probe : null,
            shellAvailable: true
        });

        me.admitReply(evaluation, 'The recipe could not be evaluated')
    }

    /**
     * @summary Projects a main reply: a fresh evaluation replaces the rows; a refusal lands on the
     * status line in the shell's words and changes nothing else (never a gate).
     * @param {Object} reply `{ok, evaluation}` or `{ok: false, reason}`
     * @param {String} failureLead The status line's lead on a refusal
     * @protected
     */
    admitReply(reply, failureLead) {
        const me = this;

        if (reply?.ok && reply.evaluation) {
            me.evaluation = reply.evaluation;
            me.getReference('status-line').text = ''
        } else {
            me.getReference('status-line').text = `${failureLead}: ${reply?.reason ?? 'no answer'}`
        }
    }

    /**
     * @summary A fresh evaluation replaces every row, re-words the lede, the question lines and the
     * quiet confirmation, and publishes the run and its progress to the view root's provider.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetEvaluation(value, oldValue) {
        const me = this;

        if (!me.store) return;

        me.store.projectEvaluation(value);
        me.applyQuestionLines();
        me.applyLede();
        me.applyQuietLine();
        me.publishRun()
    }

    /**
     * @summary The budgets line follows the probe.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetProbe(value, oldValue) {
        this.getReference('budget-line')?.set({text: CreateContainer.budgetText(value)})
    }

    /**
     * @summary The preset cards follow the table (and the placement verdicts, re-applied per evaluation).
     * @param {Object[]|null} value
     * @param {Object[]|null} oldValue
     * @protected
     */
    afterSetPresets(value, oldValue) {
        this.getReference('presets') && this.applyPresetCards()
    }

    /**
     * @summary Without a shell the served path shows and the questions hide; the list stays.
     * @param {Boolean|null} value
     * @param {Boolean|null} oldValue
     * @protected
     */
    afterSetShellAvailable(value, oldValue) {
        const me = this;

        if (!me.getReference('served')) return;

        me.getReference('served').hidden    = value !== false;
        me.getReference('questions').hidden = value === false
    }

    /**
     * @summary The budgets line: both budgets as numbers with the pressure verdict.
     * @param {Object|null} probe
     * @returns {String}
     */
    static budgetText(probe) {
        if (!probe?.host) return 'not probed yet';

        const
            {guest, host} = probe,
            hostText      = `host ${gibText(host.totalBytes)} total · ${gibText(host.availableBytes)} available · pressure ${host.pressure ?? 'unknown'}`,
            guestText     = guest ? ` · VM ${gibText(guest.capBytes)} cap · ${gibText(guest.availableBytes)} available` : ' · no VM observed';

        return `${hostText}${guestText}`
    }

    /**
     * @summary The question rows read their step: the credential path, the provider-key verdict,
     * the advanced fold.
     * @protected
     */
    applyQuestionLines() {
        const
            me         = this,
            step       = id => me.store.get(id),
            credential = step('plane-credential'),
            key        = step('provider-key'),
            advanced   = step('advanced');

        me.getReference('credential-line').text = credential?.status === 'ok'
            ? `consented · ${credential.answer ?? 'a kept file'}${credential.consentedAt ? ` · ${credential.consentedAt}` : ''}`
            : 'the PAT is entered in the vessel\'s own window and kept as an owner-only file; this card only ever shows its path';
        me.getReference('credential-button').text = credential?.status === 'ok' ? 'Change' : 'Open the credential window';
        me.getReference('provider-key-line').text = key?.reason ?? 'decided by the preset';
        me.getReference('advanced-line').text     = advanced?.reason ?? 'folded: defaults apply';
        me.getReference('placement-line').text    = CreateContainer.placementText(step('placement')?.placement ?? null);
        me.applyPresetCards()
    }

    /**
     * @summary The frame the three verdicts answer: the recommended presets, or that none is and
     * each card says why.
     * @param {Object|null} placement The placement step's `{recommended, possible, refused}`
     * @returns {String}
     */
    static placementText(placement) {
        if (!placement) return '';

        const recommended = placement.recommended ?? [];

        return recommended.length > 0
            ? `recommended: ${recommended.map(row => row.id).join(', ')}`
            : 'nothing recommended — each preset says why'
    }

    /**
     * @summary One card per preset: its facts from the table, its verdict from the placement step,
     * the chosen one marked, a refused one visible but disabled with the shortfall.
     * @protected
     */
    applyPresetCards() {
        const
            me        = this,
            container = me.getReference('presets'),
            placement = me.store?.get('placement')?.placement ?? null,
            chosen    = me.store?.get('preset')?.answer ?? null,
            presets   = me.presets ?? [];

        if (!container) return;

        container.removeAll();

        if (presets.length === 0) {
            container.add({ntype: 'component', cls: ['fm-setup-q-note'], text: 'the preset table has not answered'});
            return
        }

        container.add(presets.map(preset => {
            const
                {margins, reason, verdict} = presetVerdict(placement, preset.id),
                refused                    = verdict === 'refused',
                workload                   = preset.workload ?? {},
                facts                      = `chat ${preset.chatModel} · embed ${preset.embedder} · ${preset.vectorDimension} dims`,
                // the decision numbers: the plane's own footprint, the models, the floor's date
                footprint                  = preset.inference === 'local'
                    ? `models ${gibText(workload.modelsBytes)} · ${preset.qualityFloor?.measuredAt ? `floor recorded ${preset.qualityFloor.measuredAt}` : 'no recorded floor'}`
                    : `plane ${Number.isFinite(workload.planeIdleBytes) ? (workload.planeIdleBytes / GiB).toFixed(1) : '?'}–${gibText(workload.planePeakBytes)} · no local models · needs a provider key`,
                margin                     = Number.isFinite(margins?.host) && margins.host >= 0 ? ` · ${gibText(margins.host)} host margin` : '';

            return {
                ntype    : 'container',
                cls      : ['fm-setup-preset', `is-${verdict}`, ...(chosen === preset.id ? ['is-chosen'] : []), ...(refused ? ['is-refused'] : [])],
                layout   : {ntype: 'vbox'},
                presetId : preset.id,
                items    : [
                    {ntype: 'component', cls: ['fm-setup-preset-name'],    text: preset.label ?? preset.id},
                    {ntype: 'component', cls: ['fm-setup-preset-fact'],    text: facts},
                    {ntype: 'component', cls: ['fm-setup-preset-fact'],    text: footprint},
                    {ntype: 'component', cls: ['fm-setup-preset-verdict'], text: `${verdict} — ${reason}${margin}`},
                    {module: Button, cls: ['fm-setup-preset-choose'], disabled: refused || chosen === preset.id, handler: 'up.onPresetClick', presetId: preset.id, text: chosen === preset.id ? 'chosen' : 'choose'}
                ]
            }
        }))
    }

    /**
     * @summary The lede names a resumed run and its binding; a cold run keeps the door's own words.
     * @protected
     */
    applyLede() {
        const
            me         = this,
            evaluation = me.evaluation;

        if (evaluation?.binding && evaluation.binding !== 'bound' && evaluation.binding !== 'no-record') {
            me.getReference('lede').text = `Resumed from the run record (${evaluation.runId ?? 'unknown run'}): ${evaluation.bindingReason ?? evaluation.binding}. Prior consents and receipts are history now; every step reads fresh.`
        } else if (evaluation?.runId && evaluation.steps?.some(step => step.kind === 'effect' && step.receipt)) {
            me.getReference('lede').text = `Resumed from the run record (${evaluation.runId}, bound to ${evaluation.target?.planeId ?? 'this plane'} at ${evaluation.target?.dataRoot ?? 'its data root'}). An interrupted effect is never run again; a fresh observation that matches the plane settles it.`
        } else {
            me.getReference('lede').text = 'A plane of your own on this machine: Docker, one inference preset, your GitHub or GitLab PAT. Nothing is written until you say so, each step says what it observed, and the frame stays usable behind this card.'
        }
    }

    /**
     * @summary The quiet confirmation: the `done` step's own text once it reads `ok`, with the chosen
     * preset and dimension beside it. One line, no modal. The door then retires from the primary
     * slot: it fires `firstPersistence` once and its owner moves it aside.
     * @protected
     */
    applyQuietLine() {
        const
            me       = this,
            done     = me.store.get('done'),
            preset   = me.store.get('preset'),
            table    = me.presets?.find(row => row.id === preset?.answer),
            quiet    = me.getReference('quiet-line'),
            finished = done?.status === 'ok';

        quiet.set({
            hidden: !finished,
            text  : finished ? `${done.reason}${table ? ` · ${table.id} · ${table.vectorDimension}-dim` : ''} · the set-up card stays in the rail` : ''
        });

        if (finished && !me.firstPersistenceFired) {
            me.firstPersistenceFired = true;
            me.fire('firstPersistence', {density: countDensity(me.evaluation, me.manualActions), evaluation: me.evaluation})
        }
    }

    /**
     * @summary Publishes the run and the progress line's facts to the view root's provider: the
     * chrome's progress binds to them, and they are derived from the step rows alone.
     * @protected
     */
    publishRun() {
        const
            me         = this,
            provider   = me.getStateProvider(),
            evaluation = me.evaluation;

        if (!provider) return;

        const density = countDensity(evaluation, me.manualActions);

        // leaf-complete blocks: the provider's data is a tree of leaves, so every key is written
        // with a value (null for "no run"), never a block replaced wholesale
        provider.setData({
            setupProgress: me.store.describeProgress(),
            setupRun     : {
                dataRoot     : evaluation?.target?.dataRoot ?? null,
                decisions    : evaluation ? density.decisions : null,
                manualActions: evaluation ? density.manualActions : null,
                planeId      : evaluation?.target?.planeId ?? null,
                preset       : me.store.get('preset')?.answer ?? null,
                recipeVersion: evaluation?.recipeVersion ?? null,
                runId        : evaluation?.runId ?? null
            }
        })
    }

    /**
     * @summary A row's action is a request to main; the reply is a fresh evaluation.
     * @param {Object} data
     * @param {Object} data.record The clicked step record
     * @returns {Promise<void>}
     */
    async onStepClick({record}) {
        const
            me     = this,
            action = actionFor(record);

        switch (action) {
            case 'open window':
                return me.onCredentialClick(record.id);
            case 'run':
                return me.runEffect(record.effectId);
            case 're-check':
            case 're-read':
            case 'retry':
                return me.admitReply(await me.callShell('setupEvaluate'), 'The recipe could not be re-evaluated');
            case 'which plane?':
                me.getReference('status-line').text = record.served
                    ? `the served plane is '${record.served.planeId ?? 'unnamed'}' at ${record.served.dataRoot ?? 'an unknown data root'}; the target is '${me.evaluation?.target?.planeId ?? 'unnamed'}'`
                    : record.reason;
                return;
            case 'open memories':
                me.fire('openMemories', {});
                return;
            default:
                return
        }
    }

    /**
     * @summary Consents to one effect. A shell that cannot run it answers why; the row's action then
     * becomes the operator's instruction, counted as a manual action.
     * @param {String} effectId
     * @returns {Promise<void>}
     */
    async runEffect(effectId) {
        const
            me    = this,
            reply = await me.callShell('setupEffect', {effectId});

        if (me.isDestroyed) return;

        if (!reply.ok) {
            me.manualActions++;
            me.getReference('status-line').text = `${effectId}: ${reply.reason ?? 'the shell could not run it'} — run \`${CLI_COMMAND.replace(' --json', '')}\` on the host, then re-check`;
            return
        }

        me.admitReply(reply, `${effectId} could not run`)
    }

    /**
     * @summary Chooses a preset: one consent, re-evaluated by main.
     * @param {Object} data The button's click data
     * @returns {Promise<void>}
     */
    async onPresetClick(data) {
        const
            me       = this,
            presetId = data?.component?.presetId;

        if (!presetId) return;

        me.admitReply(await me.callShell('setupAnswer', {answer: presetId, stepId: 'preset'}), `The preset '${presetId}' was refused`)
    }

    /**
     * @summary Opens main's credential window for the plane credential (or the provider key); the
     * reply names the kept file's path beside the re-evaluated steps.
     * @param {String} [stepId='plane-credential']
     * @returns {Promise<void>}
     */
    async onCredentialClick(stepId = 'plane-credential') {
        const
            me     = this,
            button = me.getReference('credential-button'),
            id     = typeof stepId === 'string' ? stepId : 'plane-credential';

        button.disabled = true;
        me.getReference('status-line').text = 'Enter the credential in the window that opens.';

        const reply = await me.callShell('setupCredential', {stepId: id});

        if (me.isDestroyed) return;

        button.disabled = false;
        me.admitReply(reply, reply?.reason === 'canceled' ? 'Canceled. Nothing was stored' : 'The credential was not kept')
    }

    /**
     * @summary A served cockpit projects the CLI's pasted `--json` through the same list.
     */
    onProjectPastedClick() {
        const
            me   = this,
            text = me.getReference('pasted-json').value ?? '';

        try {
            const parsed = JSON.parse(text);

            if (!Array.isArray(parsed?.steps)) {
                throw new Error('no steps array')
            }

            me.evaluation = parsed;
            me.getReference('status-line').text = ''
        } catch (error) {
            me.getReference('status-line').text = `That is not the command's JSON: ${error.message}`
        }
    }
}

export default Neo.setupClass(CreateContainer);
