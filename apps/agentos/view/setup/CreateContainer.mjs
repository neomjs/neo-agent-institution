import Button         from '../../../../node_modules/neo.mjs/src/button/Base.mjs';
import Container      from '../../../../node_modules/neo.mjs/src/container/Base.mjs';
import {isDescriptor} from '../../../../node_modules/neo.mjs/src/core/ConfigSymbols.mjs';
import SetupSteps     from '../../store/SetupSteps.mjs';
import StepList       from './StepList.mjs';
import {actionsFor}   from './StepList.mjs';
import TextArea       from '../../../../node_modules/neo.mjs/src/form/field/TextArea.mjs';
import SetupAsks      from '../../util/SetupAsks.mjs';

const
    GiB       = 1073741824,
    COLD_LEDE = 'Three questions, then one action at a time. Nothing is written until you say so, and every step says what it observed.';

/**
 * @summary One question block: the title, then the block's own lines and controls, every one sized
 * to its content (the engine's column would hand them `flex: 1` inline).
 * @param {String} id `token` | `where` | `start`
 * @param {String} title
 * @param {Object[]} items
 * @returns {Object}
 */
const askBlock = (id, title, items) => ({
    ntype    : 'container',
    cls      : ['fm-setup-ask', `fm-setup-ask-${id}`, 'is-next'],
    flex     : 'none',
    layout   : {ntype: 'vbox'},
    reference: `ask-${id}`,
    items    : [{ntype: 'component', cls: ['fm-setup-ask-title'], flex: 'none', text: title}, ...items]
});

/**
 * @summary A block's control row: its one primary action, the quiet links beside it, wrapping.
 * @param {String} id
 * @param {Object[]} items
 * @returns {Object}
 */
const controls = (id, items) => ({
    ntype    : 'container',
    cls      : ['fm-setup-ask-controls'],
    flex     : 'none',
    layout   : {ntype: 'hbox', align: 'center'},
    reference: `${id}-controls`,
    items
});

/**
 * @summary The text link that opens an answered block again.
 * @param {String} id
 * @returns {Object}
 */
const changeLink = id => ({
    module   : Button,
    askId    : id,
    cls      : ['fm-setup-link', 'fm-setup-change'],
    handler  : 'up.onChangeClick',
    hidden   : true,
    reference: `${id}-change`,
    text     : 'Change'
});

/**
 * @summary The setup card's **Create** door: the first-run recipe projected inline as three questions
 * in the operator's words — the token, where it runs, start — one open at a time, with the recipe's
 * ledger under Details. Every row is the vessel's fresh evaluation for the bound target (the CLI's
 * `--json` shape); the door stores nothing, remembers no "completed" bit, and sends every action to
 * main as a request whose reply is a fresh evaluation. The quiet confirmation is the `done` step's
 * own text at first persistence. Without a shell the door shows the CLI's command and projects a
 * pasted evaluation through the same list.
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
         * bindingReason, steps, terminal}`), or the pasted one in a served cockpit. An answer is an
         * observation, so one equal to the held answer is fresh too: the config never reports equality.
         * @member {Object|null} evaluation_=null
         * @reactive
         */
        evaluation_: {
            [isDescriptor]: true,
            isEqual       : () => false,
            value         : null
        },
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
         * Whether the recipe's ledger shows under the questions. This session's choice, never stored.
         * @member {Boolean} detailsOpen=false
         */
        detailsOpen: false,
        /**
         * Whether the preset choices show under the Where block. Opens by itself while nothing is
         * recommended, and on Change; never closes by itself.
         * @member {Boolean} otherChoicesOpen=false
         */
        otherChoicesOpen: false,
        /**
         * The answered block the operator opened again with Change, until the next evaluation.
         * @member {String|null} reopened=null
         */
        reopened: null,
        /**
         * @member {Object[]} items
         */
        items: [{
            ntype    : 'component',
            cls      : ['agent-plane-setup-lede'],
            flex     : 'none',
            reference: 'lede',
            text     : COLD_LEDE
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
                text : SetupAsks.CLI_COMMAND
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
            cls      : ['fm-setup-questions', 'fm-setup-asks'],
            flex     : 'none',
            layout   : {ntype: 'vbox'},
            reference: 'questions',
            items    : [
                askBlock('token', 'Your GitHub token', [
                    {ntype: 'component', cls: ['fm-setup-ask-line'], flex: 'none', reference: 'credential-line', text: 'One token. It lets your agents read and write your repositories, and it signs you in here.'},
                    controls('token', [
                        {module: Button, cls: ['agent-plane-setup-connect', 'fm-setup-credential-button'], handler: 'up.onCredentialClick', reference: 'credential-button', text: 'Enter your token'},
                        changeLink('token')
                    ]),
                    {ntype: 'component', cls: ['fm-setup-ask-help'], flex: 'none', reference: 'credential-help', text: 'Entered in the vessel\'s own window and kept as an owner-only file; this card only ever shows its path.'}
                ]),
                askBlock('where', 'Where it runs', [
                    {ntype: 'component', cls: ['fm-setup-ask-line'], flex: 'none', reference: 'placement-line', text: 'Measuring this machine…'},
                    controls('where', [
                        {module: Button, cls: ['agent-plane-setup-connect', 'fm-setup-use-button'], handler: 'up.onUseClick', hidden: true, reference: 'use-button', text: 'Use this'},
                        {module: Button, cls: ['agent-plane-setup-connect', 'fm-setup-key-button'], handler: 'up.onProviderKeyClick', hidden: true, reference: 'provider-key-button', text: 'Enter the provider key'},
                        {module: Button, cls: ['fm-setup-link', 'fm-setup-other-choices-toggle'], handler: 'up.onOtherChoicesClick', reference: 'other-choices-toggle', text: 'Other choices'},
                        changeLink('where')
                    ]),
                    {ntype: 'component', cls: ['fm-setup-ask-help', 'fm-setup-key-line'], flex: 'none', hidden: true, reference: 'provider-key-line', text: ''},
                    {ntype: 'component', cls: ['fm-setup-ask-help', 'fm-setup-budget'], flex: 'none', reference: 'budget-line', text: 'not probed yet'},
                    {ntype: 'container', cls: ['fm-setup-presets'], flex: 'none', hidden: true, layout: {ntype: 'base'}, reference: 'presets', items: []}
                ]),
                askBlock('start', 'Start', [
                    {ntype: 'component', cls: ['fm-setup-ask-line'], flex: 'none', reference: 'start-line', text: ''},
                    controls('start', [
                        {module: Button, cls: ['agent-plane-setup-connect', 'fm-setup-start-button'], handler: 'up.onStartClick', hidden: true, reference: 'start-button', text: 'Run next step'}
                    ]),
                    {ntype: 'component', cls: ['fm-setup-ask-help'], flex: 'none', reference: 'start-help', text: ''}
                ])
            ]
        }, {
            module   : Button,
            cls      : ['fm-setup-link', 'fm-setup-details-toggle'],
            flex     : 'none',
            handler  : 'up.onDetailsClick',
            reference: 'details-toggle',
            text     : 'Details'
        }, {
            module   : StepList,
            flex     : 'none',
            hidden   : true,
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
     * @summary Takes the next observation ticket: every call that can answer an evaluation takes
     * one before it leaves, and a reply is admitted only while no later ticket has been admitted —
     * a slow refresh that lands after a newer consent's reply is superseded, never projected.
     * @returns {Number}
     * @protected
     */
    takeTicket() {
        this.ticketSeq = (this.ticketSeq ?? 0) + 1;

        return this.ticketSeq
    }

    /**
     * @summary Whether a reply with this ticket is still current.
     * @param {Number} ticket
     * @returns {Boolean}
     * @protected
     */
    isCurrent(ticket) {
        return ticket >= (this.admittedTicket ?? 0)
    }

    /**
     * @summary Asks main for the evaluation, the probe and the presets in one go, then projects
     * them. Without a shell the door switches to the served path. A newer reply admitted while
     * this read was in flight wins: the read's answer is dropped.
     * @returns {Promise<void>}
     */
    async refresh() {
        const
            me                            = this,
            ticket                        = me.takeTicket(),
            [evaluation, probe, presets]  = await Promise.all([me.callShell('setupEvaluate'), me.callShell('setupProbe'), me.callShell('setupPresets')]);

        if (me.isDestroyed || !me.isCurrent(ticket)) return;

        if (evaluation.reason === 'no-shell') {
            me.shellAvailable = false;
            return
        }

        me.set({
            presets       : presets.ok ? presets.presets : null,
            probe         : probe.ok ? probe.probe : null,
            shellAvailable: true
        });

        me.admitReply(evaluation, 'The recipe could not be evaluated', {observation: true, ticket})
    }

    /**
     * @summary One evaluation read (a re-check, a re-read, a retry) under its own ticket.
     * @param {String} failureLead
     * @returns {Promise<void>}
     * @protected
     */
    async reevaluate(failureLead) {
        const
            me     = this,
            ticket = me.takeTicket(),
            reply  = await me.callShell('setupEvaluate');

        me.isDestroyed || me.admitReply(reply, failureLead, {observation: true, ticket})
    }

    /**
     * @summary Projects a main reply. A fresh evaluation replaces the rows. A failed OBSERVATION
     * (an evaluation read that did not answer) turns every row `unknown` with the reason — a
     * previously green row is no longer a current observation and never stays green. A refused
     * ACTION (a preset the shell refused, a credential not kept) lands on the status line in the
     * shell's words and changes no row: the last observation still stands. A reply from a ticket
     * older than the last admitted one is dropped.
     * @param {Object} reply `{ok, evaluation}` or `{ok: false, reason}`
     * @param {String} failureLead The status line's lead on a refusal
     * @param {Object} [options]
     * @param {Boolean} [options.observation=false] The reply answers an evaluation read
     * @param {Number} [options.ticket] The reply's observation ticket
     * @protected
     */
    admitReply(reply, failureLead, {observation = false, ticket = null} = {}) {
        const me = this;

        if (ticket !== null) {
            if (!me.isCurrent(ticket)) return;

            me.admittedTicket = ticket
        }

        if (reply?.ok && reply.evaluation) {
            me.evaluation = reply.evaluation;
            me.getReference('status-line').text = '';
            return
        }

        const reason = `${failureLead}: ${reply?.reason ?? 'no answer'}`;

        me.getReference('status-line').text = reason;

        if (observation && me.evaluation) {
            // the held observation is not current any more: every row says so, in the read's words
            me.evaluation = {
                ...me.evaluation,
                steps   : me.evaluation.steps.map(step => ({...step, status: 'unknown', reason})),
                terminal: null
            }
        }
    }

    /**
     * @summary A fresh evaluation replaces every row, re-words the three blocks, the lede and the
     * quiet confirmation, closes a block opened with Change, and publishes the run and its progress
     * to the view root's provider.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     * @protected
     */
    afterSetEvaluation(value, oldValue) {
        const me = this;

        if (!me.store) return;

        // a fresh evaluation ends a pending confirmation; silent, the projection draws the rows once
        me.getReference('step-list')._confirmingId = null;
        me.reopened = null;
        me.store.projectEvaluation(value);
        me.applyAsks();
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
     * @summary The Where block and its choices follow the table (with the placement verdicts,
     * re-applied per evaluation).
     * @param {Object[]|null} value
     * @param {Object[]|null} oldValue
     * @protected
     */
    afterSetPresets(value, oldValue) {
        this.getReference('presets') && this.applyAsks()
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
            hostText      = `host ${SetupAsks.gibText(host.totalBytes)} total · ${SetupAsks.gibText(host.availableBytes)} available · pressure ${host.pressure ?? 'unknown'}`,
            guestText     = guest ? ` · VM ${SetupAsks.gibText(guest.capBytes)} cap · ${SetupAsks.gibText(guest.availableBytes)} available` : ' · no VM observed';

        return `${hostText}${guestText}`
    }

    /**
     * @summary The three blocks read their rows: each block's state, the token's kept path, the
     * Where line and its choices, the provider key when the preset needs one, and the Start block's
     * row with its one action.
     * @protected
     */
    applyAsks() {
        const
            me    = this,
            store = me.store;

        if (!store || !me.getReference('ask-token')) return;

        const
            {token, where, start, startRow} = SetupAsks.describeAsks(store, me.reopened),
            step        = id => store.get(id),
            credential  = step('plane-credential'),
            preset      = step('preset'),
            key         = step('provider-key'),
            done        = step('done'),
            placement   = step('placement')?.placement ?? null,
            presets     = me.presets ?? [],
            label       = id => presets.find(row => row.id === id)?.label ?? id,
            chosen      = preset?.answer ?? null,
            keyNeeded   = Boolean(key) && key.status !== 'ok' && !key.waitsFor,
            recommended = placement?.recommended?.[0] ?? null,
            progress    = store.describeProgress(),
            confirming  = me.getReference('step-list').confirmingId,
            // a pending write-again confirmation is the row's one open question: the block's action is
            // its second press, never the row's first exit beside it
            action      = startRow ? (confirming === startRow.id ? 'write again' : actionsFor(startRow)[0] ?? null) : null;

        me.applyAskState('token', token);
        me.applyAskState('where', where);
        me.applyAskState('start', start);

        // the token: the kept file's path, never a value
        me.getReference('credential-line').text = credential?.status === 'ok'
            ? `consented · ${credential.answer ?? 'a kept file'}${credential.consentedAt ? ` · ${credential.consentedAt}` : ''}`
            : 'One token. It lets your agents read and write your repositories, and it signs you in here.';
        me.getReference('token-change').hidden = token !== 'answered';

        // where it runs: the choice once made, the recipe's recommendation until then; a placement
        // that recommends nothing opens the choices, since the operator has to pick there
        if (placement && !recommended && !chosen) {
            me.otherChoicesOpen = true
        }

        me.getReference('placement-line').text = chosen
            ? `This machine, ${label(chosen)}${keyNeeded ? ' · needs a provider key' : key?.status === 'ok' && key.answer ? ' · provider key kept' : ''}`
            : SetupAsks.recommendationText(placement, presets);
        me.getReference('use-button').set({hidden: !recommended || chosen === recommended.id, presetId: recommended?.id ?? null, text: recommended ? `Use ${label(recommended.id)}` : 'Use this'});
        me.getReference('provider-key-button').hidden = !keyNeeded;
        me.getReference('provider-key-line').set({hidden: !keyNeeded, text: keyNeeded ? `This preset needs a provider key — ${key.reason ?? 'unanswered'}` : ''});
        me.getReference('other-choices-toggle').text = me.otherChoicesOpen ? 'Fewer choices' : 'Other choices';
        me.getReference('presets').hidden = !me.otherChoicesOpen;
        me.getReference('where-change').hidden = where !== 'answered';
        me.applyPresetCards();

        // start: the row that is not ok and waits for nothing, its action in the operator's words
        me.startRow    = startRow;
        me.startAction = action;

        me.getReference('start-line').text = done?.status === 'ok'
            ? 'Your institution is running. Add your first agent.'
            : startRow
                ? `${startRow.summary ?? startRow.id} · ${progress.ok} of ${progress.total}`
                : start === 'open'
                    ? `${progress.ok} of ${progress.total} — waiting for the plane`
                    : 'Two answers, then one action at a time.';
        me.getReference('start-help').text = startRow
            ? confirming === startRow.id
                ? 'a second row on the plane is possible · press Write again to write it'
                : `${startRow.status} · ${startRow.reason ?? ''}`
            : '';
        me.getReference('start-button').set({hidden: !action, text: SetupAsks.START_VERBS[action] ?? action ?? 'Run next step'})
    }

    /**
     * @summary One block's state class: `is-open` · `is-answered` · `is-next`.
     * @param {String} id
     * @param {String} state
     * @protected
     */
    applyAskState(id, state) {
        const block = this.getReference(`ask-${id}`);

        if (!block) return;

        block.removeCls(['is-open', 'is-answered', 'is-next']);
        block.addCls(`is-${state}`)
    }

    /**
     * @summary One card per preset under Other choices: its facts from the table, its verdict from
     * the placement step, the chosen one marked, a refused one visible but disabled with the shortfall.
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
            container.add({ntype: 'component', cls: ['fm-setup-ask-help'], text: 'the preset table has not answered'});
            return
        }

        container.add(presets.map(preset => {
            const
                {margins, reason, verdict} = SetupAsks.presetVerdict(placement, preset.id),
                refused                    = verdict === 'refused',
                workload                   = preset.workload ?? {},
                facts                      = `chat ${preset.chatModel} · embed ${preset.embedder} · ${preset.vectorDimension} dims`,
                // the decision numbers: the plane's own footprint, the models, the floor's date
                footprint                  = preset.inference === 'local'
                    ? `models ${SetupAsks.gibText(workload.modelsBytes)} · ${preset.qualityFloor?.measuredAt ? `floor recorded ${preset.qualityFloor.measuredAt}` : 'no recorded floor'}`
                    : `plane ${Number.isFinite(workload.planeIdleBytes) ? (workload.planeIdleBytes / GiB).toFixed(1) : '?'}–${SetupAsks.gibText(workload.planePeakBytes)} · no local models · needs a provider key`,
                margin                     = Number.isFinite(margins?.host) && margins.host >= 0 ? ` · ${SetupAsks.gibText(margins.host)} host margin` : '';

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
            me.getReference('lede').text = COLD_LEDE
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
            me.fire('firstPersistence', {density: SetupAsks.countDensity(me.evaluation, me.manualActions), evaluation: me.evaluation})
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

        const density = SetupAsks.countDensity(evaluation, me.manualActions);

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
     * @summary A row's action is a request to main; the reply is a fresh evaluation. The witness row's
     * exits are requests to its effect: `re-check` resumes it and writes nothing, `write again` is the
     * new attempt. A new attempt that can leave a second row on the plane is said in the row first,
     * and its second press sends it. The Start block sends the same requests for its row.
     * @param {Object} data
     * @param {String|null} [data.action] The clicked chip's action; without one the row's first action
     * @param {Object} data.record The clicked step record
     * @returns {Promise<void>}
     */
    async onStepClick({action, record}) {
        const
            me   = this,
            list = me.getReference('step-list');

        action ??= actionsFor(record)[0];

        if (action === 'write again' && record.duplicatePossible && list.confirmingId !== record.id) {
            list.confirmingId = record.id;
            me.applyAsks();
            return
        }

        list.confirmingId = null;
        me.applyAsks();

        switch (action) {
            case 'open window':
                return me.onCredentialClick(record.id);
            case 'run':
                return me.runEffect(record.effectId);
            case 'write again':
                return me.runEffect(record.effectId, true);
            case 're-check':
                return record.exits ? me.runEffect(record.effectId) : me.reevaluate('The recipe could not be re-evaluated');
            case 're-read':
            case 'retry':
                return me.reevaluate('The recipe could not be re-evaluated');
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
     * @summary The Start block's one action: its row's first request, the one the row's chip under
     * Details would send.
     * @returns {Promise<void>}
     */
    async onStartClick() {
        const me = this;

        if (me.startRow) {
            await me.onStepClick({action: me.startAction, record: me.startRow})
        }
    }

    /**
     * @summary Consents to one effect. A shell that cannot run it answers why; the row's action then
     * becomes the operator's instruction, counted as a manual action.
     * @param {String} effectId
     * @param {Boolean} [newAttempt=false] The operator's consent to write the witness again
     * @returns {Promise<void>}
     */
    async runEffect(effectId, newAttempt = false) {
        const
            me     = this,
            ticket = me.takeTicket(),
            reply  = await me.callShell('setupEffect', newAttempt ? {effectId, newAttempt: true} : {effectId});

        if (me.isDestroyed) return;

        if (!reply.ok && /^(no-brain-root|not-packaged|no-shell)/.test(reply.reason ?? '')) {
            // the shell cannot run effects at all: the row's action is the operator's instruction
            me.manualActions++;
            me.getReference('status-line').text = `${effectId}: ${reply.reason ?? 'the shell could not run it'} — run \`${SetupAsks.CLI_COMMAND.replace(' --json', '')}\` on the host, then re-check`;
            return
        }

        // a refusal from the orchestration (the preset's env set, the credential composition)
        // is the shell's own word on this effect, never a manual action
        me.admitReply(reply, `${effectId} could not run`, {ticket})
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

        const
            ticket = me.takeTicket(),
            reply  = await me.callShell('setupAnswer', {answer: presetId, stepId: 'preset'});

        me.isDestroyed || me.admitReply(reply, `The preset '${presetId}' was refused`, {ticket})
    }

    /**
     * @summary The Where block's primary action: the recommended preset, one consent.
     * @param {Object} data The button's click data
     * @returns {Promise<void>}
     */
    onUseClick(data) {
        return this.onPresetClick({component: {presetId: data?.component?.presetId}})
    }

    /**
     * @summary The Where block's second action when the chosen preset needs a provider key: main's
     * credential window for that step.
     * @returns {Promise<void>}
     */
    onProviderKeyClick() {
        return this.onCredentialClick('provider-key')
    }

    /**
     * @summary Opens an answered block again; a preset change opens the choices with it. The next
     * evaluation closes it.
     * @param {Object} data The link's click data
     */
    onChangeClick(data) {
        const
            me = this,
            id = data?.component?.askId;

        if (!id) return;

        me.reopened = id;

        if (id === 'where') {
            me.otherChoicesOpen = true
        }

        me.applyAsks()
    }

    /**
     * @summary Shows or hides the preset choices under the Where block.
     */
    onOtherChoicesClick() {
        const me = this;

        me.otherChoicesOpen = !me.otherChoicesOpen;
        me.applyAsks()
    }

    /**
     * @summary Shows or hides the recipe's ledger under the questions.
     */
    onDetailsClick() {
        const me = this;

        me.detailsOpen = !me.detailsOpen;
        me.getReference('step-list').hidden      = !me.detailsOpen;
        me.getReference('details-toggle').text   = me.detailsOpen ? 'Hide details' : 'Details'
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
            id     = typeof stepId === 'string' ? stepId : 'plane-credential',
            button = me.getReference(id === 'provider-key' ? 'provider-key-button' : 'credential-button');

        button.disabled = true;
        me.getReference('status-line').text = 'Enter the credential in the window that opens.';

        const
            ticket = me.takeTicket(),
            reply  = await me.callShell('setupCredential', {stepId: id});

        if (me.isDestroyed) return;

        button.disabled = false;
        me.admitReply(reply, reply?.reason === 'canceled' ? 'Canceled. Nothing was stored' : 'The credential was not kept', {ticket})
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
