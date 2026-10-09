import AgentFreshness         from '../../util/AgentFreshness.mjs';
import BaseContainer          from '../../../../node_modules/neo.mjs/src/container/Base.mjs';
import Button                 from '../../../../node_modules/neo.mjs/src/button/Base.mjs';
import FleetAgent             from '../../model/FleetAgent.mjs';
import HomeCanvas             from './Canvas.mjs';
import OpenWorkSeat           from '../../util/OpenWorkSeat.mjs';
import {INSTANCE_STATE_WORDS} from '../fleet/instances/SwitcherButton.mjs';

/**
 * @summary What FM is, in one line: the display line's words for a first-time reader.
 * @type {String}
 */
const PRODUCT_LINE = 'Mission control for a cross-model AI engineering team.';

/**
 * @summary The first run's promise, in the operator's words: what the door behind it sets up. The
 * merge gate stays the operator's own decision, never a property of the product.
 * @type {String}
 */
const PROMISE_LINE = 'Set up your own AI engineering team — agents with memory that review each other\'s work, running on your machine. You decide what merges.';

/**
 * @summary An axis of the operator's line with nothing to say: no answer yet, or an absence another surface tells.
 * @type {Object}
 */
const SILENT = Object.freeze({kind: 'silent'});

/**
 * @summary A count and its noun: `1 merge`, `2 merges`.
 * @param {Number} count
 * @param {String} noun The singular
 * @returns {String}
 */
const counted = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/**
 * @summary The operator's line from its segments, with the reasons of the axes it names in the title.
 * @param {Object[]} segments The line's runs, `{text}` or `{link, text}`
 * @param {Object[]} axes     The axes the line names
 * @returns {{hidden: Boolean, segments: Object[], text: String, title: String|null}}
 */
const lineOf = (segments, axes) => ({
    hidden: segments.length === 0,
    segments,
    text  : segments.map(({text}) => text).join(''),
    title : axes.filter(axis => axis.reason).map(axis => `your ${axis.noun}s: ${axis.reason}`).join(' · ') || null
});

/**
 * @summary One door per keeper view, named by the question the view answers.
 * @param {String} iconCls  The view's rail icon
 * @param {String} route    The view's route
 * @param {String} question What the view answers
 * @returns {Object}
 */
const door = (iconCls, route, question) => ({
    module: Button,
    cls   : ['agent-button', 'fm-home-door'],
    flex  : 'none',
    iconCls,
    route,
    text  : question
});

/**
 * Home, the rail's first keeper view. For the returning team it answers "is the team alive, and
 * where do I go?": the team line leads in the display slot, the plane line speaks only when the plane
 * is not connected, and one door leads to each view. For a first-time operator in a packaged shell
 * without a plane it says what FM is, promises what the door sets up, and offers one action — *Set up
 * your institution* — with joining a team that already runs one as the quiet second door, and nothing
 * that reads as fleet state. Behind both, a field on the canvas worker ({@link AgentOS.view.home.Canvas}) takes the
 * pointer from the whole view and draws one mark per rostered agent from the team line's own read.
 *
 * Above everything, the operator's own line says what waits for the operator: the merges that wait for a
 * hand and the questions that wait for a word ({@link #operatorLine}). Its merge count opens the fleet
 * head's merge queue (`mergeQueueOpen`), its question count the Mailbox's open questions (`questionsOpen`).
 *
 * @summary Binds the Viewport provider's roster store and the roster surface's truths (the cockpit's
 * liveness owner fills them), the merge queue store, the open-work read's state and its questions axis, `instanceState`
 * (the chrome switcher's verdict and vocabulary) and `shellPlaneConfigured`, which the
 * ViewportController publishes from the shell's plane status (`false` only for a packaged shell
 * without a plane).
 *
 * @class AgentOS.view.home.Container
 * @extends Neo.container.Base
 */
class Container extends BaseContainer {
    static config = {
        /**
         * @member {String} className='AgentOS.view.home.Container'
         * @protected
         */
        className: 'AgentOS.view.home.Container',
        /**
         * @member {String} ntype='fm-home-view'
         * @protected
         */
        ntype: 'fm-home-view',
        /**
         * @member {String[]} baseCls=['fm-home-view']
         */
        baseCls: ['fm-home-view'],
        /**
         * @member {Object} bind
         */
        bind: {
            awaitingMergeStore  : 'stores.fleetAwaitingMerge',
            gridAdapterState    : data => data.gridAdapterState,
            gridDegradedReason  : data => data.gridDegradedReason,
            instanceState       : data => data.instanceState,
            openWork            : data => data.openWork,
            questions           : data => data.questions,
            rosterStore         : 'stores.fleetRoster',
            shellPlaneConfigured: data => data.shellPlaneConfigured
        },
        /**
         * The pointer anywhere on Home reaches the field, over the hero's lines too.
         * @member {Object} domListeners
         */
        domListeners: {
            click     : 'onFieldClick',
            mouseleave: 'onFieldLeave',
            mousemove : {fn: 'onFieldMove', local: true}
        },
        /**
         * The merge queue the cockpit's open-work read fills; the operator's line counts it.
         * @member {AgentOS.store.FleetAwaitingMerge|null} awaitingMergeStore_=null
         * @reactive
         */
        awaitingMergeStore_: null,
        /**
         * The roster surface's adapter state: `cold` until the read answers, then `live` or `stale`.
         * @member {String} gridAdapterState_='cold'
         * @reactive
         */
        gridAdapterState_: 'cold',
        /**
         * The roster surface's retained degrade reason, `null` while the read is well.
         * @member {String|null} gridDegradedReason_=null
         * @reactive
         */
        gridDegradedReason_: null,
        /**
         * The chrome's connection verdict for the bound instance: `ok` · `limited` · `off` · `starting`.
         * @member {String} instanceState_='off'
         * @reactive
         */
        instanceState_: 'off',
        /**
         * The open-work read's state, the provider's `openWork` block `{coverage, observedAt, reason, state}`.
         * @member {Object|null} openWork_=null
         * @reactive
         */
        openWork_: null,
        /**
         * The questions axis of the operator's line, the provider's `questions` block `{count, reason, state}`
         * as its source answers it ({@link AgentOS.util.OpenWorkRead#questions}): `ok` · `unsupported` ·
         * `unavailable`, or every leaf `null` while unanswered.
         * @member {Object|null} questions_=null
         * @reactive
         */
        questions_: null,
        /**
         * The roster the cockpit's liveness owner fills; the team line counts it.
         * @member {AgentOS.store.FleetRoster|null} rosterStore_=null
         * @reactive
         */
        rosterStore_: null,
        /**
         * `false` for a packaged shell without a plane, `true` for one with a plane, `null` outside a shell.
         * @member {Boolean|null} shellPlaneConfigured_=null
         * @reactive
         */
        shellPlaneConfigured_: null,
        /**
         * The field's team, `{total, up}`, from the team line's read, or `null` whenever that read has not
         * answered live: a field without an answer draws no marks.
         * @member {Object|null} team_=null
         * @reactive
         */
        team_: null,
        /**
         * Anchored at the top, so the block stays still while its lines come and go.
         * @member {Object} layout={ntype:'vbox',align:'center',pack:'start'}
         * @reactive
         */
        layout: {ntype: 'vbox', align: 'center', pack: 'start'},
        /**
         * @member {Object[]} items
         */
        items: [{
            ntype : 'container',
            cls   : ['fm-home-inner'],
            flex  : 'none',
            layout: {ntype: 'vbox', align: 'start'},
            items : [{
                ntype    : 'component',
                tag      : 'p',
                cls      : ['fm-home-operator'],
                hidden   : true,
                reference: 'operator-line'
            }, {
                ntype    : 'component',
                tag      : 'p',
                cls      : ['fm-home-eyebrow'],
                reference: 'eyebrow',
                text     : 'Neo Agent OS'
            }, {
                ntype    : 'component',
                tag      : 'h1',
                cls      : ['fm-home-h1'],
                reference: 'lead',
                text     : PRODUCT_LINE
            }, {
                ntype    : 'component',
                tag      : 'p',
                cls      : ['fm-home-lede'],
                reference: 'lede',
                text     : PROMISE_LINE
            }, {
                ntype    : 'component',
                tag      : 'p',
                cls      : ['fm-home-plane'],
                hidden   : true,
                reference: 'plane-line',
                text     : ''
            }, {
                ntype    : 'container',
                cls      : ['fm-home-doors'],
                layout   : {ntype: 'vbox', align: 'start'},
                reference: 'doors',
                items    : [
                    door('fa-solid fa-satellite-dish', '/fleet',       'What is the team doing?'),
                    door('fa-solid fa-circle-nodes',   '/observatory', 'What does the organism know?'),
                    door('fa-solid fa-server',         '/system',      'Is the plane healing itself?')
                ]
            }, {
                // the first run's two doors: the declared one as the primary action, joining as a text link
                ntype    : 'container',
                cls      : ['fm-home-first-run'],
                flex     : 'none',
                hidden   : true,
                layout   : {ntype: 'vbox', align: 'start'},
                reference: 'first-run',
                items    : [{
                    module   : Button,
                    cls      : ['agent-button', 'agent-submit-button', 'fm-home-setup'],
                    flex     : 'none',
                    handler  : 'onSetupInstitution',
                    reference: 'setup-institution',
                    text     : 'Set up your institution'
                }, {
                    ntype    : 'component',
                    tag      : 'p',
                    cls      : ['fm-home-setup-line'],
                    flex     : 'none',
                    reference: 'setup-line',
                    text     : 'A GitHub token · where it runs · start.'
                }, {
                    // the second door: the question in plain words, only the verb is the link
                    ntype    : 'container',
                    cls      : ['fm-home-connect-line'],
                    flex     : 'none',
                    layout   : {ntype: 'hbox', align: 'baseline'},
                    reference: 'connect-line',
                    items    : [{
                        ntype    : 'component',
                        tag      : 'span',
                        cls      : ['fm-home-connect-question'],
                        flex     : 'none',
                        reference: 'connect-question',
                        text     : 'Joining a team that already runs one?'
                    }, {
                        module   : Button,
                        cls      : ['fm-home-link', 'fm-home-connect'],
                        flex     : 'none',
                        handler  : 'onConnectInstitution',
                        reference: 'connect-plane',
                        text     : 'Connect to it'
                    }]
                }]
            }]
        }]
    }

    /**
     * @summary The team line's words from the roster surface: who is up, once the read answers live;
     * before that, and whenever it cannot answer, the read's own state, so an unanswered roster never
     * reads as an empty team. "Up" is the roster's online and idle tiers (`FleetAgent.tierRankFor`).
     * @param {Object}      facts
     * @param {String}      facts.adapterState   `cold` · `live` · `stale`
     * @param {String|null} facts.degradedReason
     * @param {String[]}    facts.states         The roster rows' session states
     * @returns {{answered: Boolean, team: Object|null, text: String}} `team` is the field's `{total, up}`, only
     * once the read answers
     */
    static teamLine({adapterState, degradedReason, states}) {
        if (adapterState === 'cold') {
            return {answered: false, team: null, text: 'No word from the team yet'}
        }

        if (adapterState !== 'live' || degradedReason) {
            return {answered: false, team: null, text: 'Lost touch with the team'}
        }

        const
            total = states.length,
            up    = states.filter(state => FleetAgent.tierRankFor(state) < 2).length;

        return {answered: true, team: {total, up}, text: total ? `${up} of ${total} ${total === 1 ? 'agent' : 'agents'} up` : 'No agents yet'}
    }

    /**
     * @summary The merge axis of the operator's line, read for what it can claim. A bridge without the
     * open-work verb, or a read that threw, is the connection's story and stays silent; only the producer's
     * own `unavailable` is named. A counted queue keeps its completeness and its age apart, so neither a
     * partial nor a stale zero reads as a current one. A stale queue ages from its oldest row.
     * @param {Object|null} openWork  The provider's `openWork` block
     * @param {Object[]}    mergeRows The merge queue's rows (`{observedAt, stale}`)
     * @param {Number}      now       The viewer's clock
     * @returns {Object} `{kind: 'silent'}`, `{kind: 'numberless', phrase, reason}` or `{kind: 'counted', asOf, complete, count, reason}`
     */
    static mergeAxis(openWork, mergeRows, now) {
        const state = openWork?.state ?? null;

        if (state === 'unavailable') {
            return openWork.coverage === 'unavailable' ? {kind: 'numberless', phrase: 'could not be read', reason: openWork.reason} : SILENT
        }

        if (state !== 'ok' && state !== 'stale') return SILENT;

        const
            stale      = state === 'stale' || mergeRows.some(row => row.stale === true),
            observedAt = OpenWorkSeat.oldestObservedAt(mergeRows) ?? openWork.observedAt,
            ageMs      = stale && observedAt ? now - Date.parse(observedAt) : NaN,
            // a stale read that cannot say when its count held is not a complete one
            complete   = openWork.coverage === 'complete' && (!stale || Number.isFinite(ageMs));

        return {
            kind      : 'counted',
            asOf      : Number.isFinite(ageMs) ? ` as of ${AgentFreshness.formatAge(ageMs)}` : '',
            complete,
            count     : mergeRows.length,
            // a partial read's count is the least that waits
            lowerBound: openWork.coverage !== 'complete',
            reason    : complete ? null : openWork.reason
        }
    }

    /**
     * @summary The questions axis of the operator's line, as its source answers it
     * ({@link AgentOS.util.OpenWorkRead#questions}): `ok` counts, `unsupported` and `unavailable` name
     * themselves with the source's reason, and no answer is silent.
     * @param {Object|null} questions The provider's `questions` block `{count, reason, state}`
     * @returns {Object} An axis, shaped as {@link #mergeAxis} returns one
     */
    static questionsAxis(questions) {
        switch (questions?.state) {
            case 'ok':
                return Number.isInteger(questions.count) ? {kind: 'counted', asOf: '', complete: true, count: questions.count, reason: null} : SILENT;
            case 'unsupported':
                return {kind: 'numberless', phrase: 'are not listed yet', reason: questions.reason};
            case 'unavailable':
                return {kind: 'numberless', phrase: 'could not be read', reason: questions.reason};
            default:
                return SILENT
        }
    }

    /**
     * @summary The operator's own line: what waits for a hand (merges) and for a word (questions), one count
     * that belongs to the operator alone. "nothing waits for you" is said only when both axes are complete
     * and observed zero, and a stale observation keeps its age. An axis without a number leads, and so does
     * a zero that is not complete, each with its reason in the title. The other axis keeps its number,
     * never a 0, and a partial count reads as the least that waits ("at least 5 merges … · some could not
     * be read"). Any axis with something to say lights the line, so a silent one never hides a known count;
     * with nothing to say, the line is hidden. The merge count links to the fleet head's merge queue, the
     * question count to the Mailbox's open questions.
     * @param {Object}      facts
     * @param {Object|null} facts.openWork  The provider's `openWork` block: the merge axis's state
     * @param {Object[]}    facts.mergeRows The merge queue's rows (`{observedAt, stale}`)
     * @param {Object|null} facts.questions The provider's `questions` block `{count, reason, state}`
     * @param {Number}      [facts.now=Date.now()] The viewer's clock, for a stale queue's age
     * @returns {{hidden: Boolean, segments: Object[], text: String, title: String|null}} `segments` are the
     * line's runs: `{text}`, or `{link, text}` for a count, `link` `merges` or `questions`
     */
    static operatorLine({openWork, mergeRows = [], questions, now = Date.now()}) {
        const axes = [
            {noun: 'question', ...Container.questionsAxis(questions)},
            {noun: 'merge',    ...Container.mergeAxis(openWork, mergeRows, now)}
        ];

        if (axes.every(axis => axis.kind === 'counted' && axis.complete && axis.count === 0)) {
            return lineOf([{text: `nothing waits for you${axes.find(axis => axis.asOf)?.asOf ?? ''}`}], [])
        }

        const
            numberless = axes.filter(axis => axis.kind === 'numberless' || (axis.kind === 'counted' && axis.count === 0 && !axis.complete)),
            waiting    = axes.filter(axis => axis.kind === 'counted' && axis.count > 0),
            runs       = numberless.map(axis => [{text: `your ${axis.noun}s ${axis.phrase ?? 'could not all be read'}`}]);

        if (waiting.length > 0) {
            const one = waiting.length === 1 && waiting[0].count === 1;

            runs.push([
                ...waiting.flatMap((axis, index) => [
                    ...(index ? [{text: ' · '}] : []),
                    {link: `${axis.noun}s`, text: (axis.lowerBound ? 'at least ' : '') + counted(axis.count, axis.noun) + axis.asOf}
                ]),
                {text: ` ${one ? 'waits' : 'wait'} for you`}
            ]);

            waiting.some(axis => axis.lowerBound) && runs.push([{text: 'some could not be read'}])
        }

        return lineOf(runs.flatMap((run, index) => [...(index ? [{text: ' · '}] : []), ...run]), [...numberless, ...waiting])
    }

    /**
     * @summary Renders whatever the provider already holds: Home is built before the first read lands. The
     * field joins behind the hero wherever a canvas worker runs.
     * @param {...*} args
     */
    onConstructed(...args) {
        const me = this;

        super.onConstructed(...args);

        if (Neo.config.useCanvasWorker && !Neo.config.unitTestMode) {
            me.insert(0, {
                module   : HomeCanvas,
                quietIds : ['operator-line', 'eyebrow', 'lead', 'lede', 'plane-line'].map(reference => me.getReference(reference).id),
                reference: 'canvas',
                team     : me.team
            })
        }

        me.applyState()
    }

    /** @param {...*} args */
    destroy(...args) {
        this.awaitingMergeStore?.un({load: this.applyState, recordChange: this.applyState, scope: this});
        this.rosterStore?.un({load: this.applyState, recordChange: this.applyState, scope: this});
        super.destroy(...args)
    }

    /**
     * @summary Follows the merge queue: each open-work answer replaces its rows, and the operator's line recounts.
     * @param {AgentOS.store.FleetAwaitingMerge|null} value
     * @param {AgentOS.store.FleetAwaitingMerge|null} oldValue
     */
    afterSetAwaitingMergeStore(value, oldValue) {
        oldValue?.un({load: this.applyState, recordChange: this.applyState, scope: this});
        value   ?.on({load: this.applyState, recordChange: this.applyState, scope: this});
        this.isConstructed && this.applyState()
    }

    /** @param {String} value @param {String} oldValue */
    afterSetGridAdapterState(value, oldValue) {
        this.isConstructed && this.applyState()
    }

    /** @param {String|null} value @param {String|null} oldValue */
    afterSetGridDegradedReason(value, oldValue) {
        this.isConstructed && this.applyState()
    }

    /** @param {String} value @param {String} oldValue */
    afterSetInstanceState(value, oldValue) {
        this.isConstructed && this.applyState()
    }

    /** @param {Object|null} value @param {Object|null} oldValue */
    afterSetOpenWork(value, oldValue) {
        this.isConstructed && this.applyState()
    }

    /** @param {Object} value @param {Object} oldValue */
    afterSetQuestions(value, oldValue) {
        this.isConstructed && this.applyState()
    }

    /**
     * @summary Follows the roster: a reload and a row whose state changes both move the team line.
     * @param {AgentOS.store.FleetRoster|null} value
     * @param {AgentOS.store.FleetRoster|null} oldValue
     */
    afterSetRosterStore(value, oldValue) {
        oldValue?.un({load: this.applyState, recordChange: this.applyState, scope: this});
        value   ?.on({load: this.applyState, recordChange: this.applyState, scope: this});
        this.isConstructed && this.applyState()
    }

    /** @param {Boolean|null} value @param {Boolean|null} oldValue */
    afterSetShellPlaneConfigured(value, oldValue) {
        this.isConstructed && this.applyState()
    }

    /**
     * @summary The field follows the team line's read.
     * @param {Object|null} value
     * @param {Object|null} oldValue
     */
    afterSetTeam(value, oldValue) {
        const canvas = this.getReference('canvas');

        canvas && (canvas.team = value)
    }

    /**
     * @summary Picks the reader. A packaged shell without a plane gets the product line, the promise and
     * the first run's two doors. Everyone else gets the operator's line above everything, the team line in the
     * display slot, the plane line whenever the chrome's verdict is not `ok`, and the doors. The field's
     * team comes from the team line's read.
     */
    applyState() {
        const
            me       = this,
            firstRun = me.shellPlaneConfigured === false,
            state    = me.instanceState,
            word     = Object.hasOwn(INSTANCE_STATE_WORDS, state) ? INSTANCE_STATE_WORDS[state] : INSTANCE_STATE_WORDS.off,
            line     = firstRun ? null : Container.teamLine({
                adapterState  : me.gridAdapterState,
                degradedReason: me.gridDegradedReason,
                states        : me.rosterStore?.items.map(record => record.state) ?? []
            }),
            operator = firstRun ? {hidden: true, segments: [], title: null} : Container.operatorLine({
                openWork : me.openWork,
                mergeRows: me.awaitingMergeStore?.items ?? [],
                questions: me.questions
            }),
            operatorLine = me.getReference('operator-line');

        Object.assign(operatorLine.vdom, {
            cn: operator.segments.map(({link, text}) => link
                ? {tag: 'button', type: 'button', cls: ['fm-home-operator-link', `is-${link}`], text}
                : {tag: 'span', text}),
            title: operator.title
        });
        operatorLine.set({hidden: operator.hidden});
        operatorLine.update();

        me.getReference('lead').set({
            cls : line && !line.answered ? ['fm-home-h1', 'is-quiet'] : ['fm-home-h1'],
            text: line?.text ?? PRODUCT_LINE
        });

        me.getReference('lede').hidden      = !firstRun;
        me.getReference('first-run').hidden = !firstRun;
        me.getReference('doors').hidden     = firstRun;

        me.getReference('plane-line').set({hidden: firstRun || state === 'ok', text: `Plane ${word}`});

        me.team = line?.team ?? null;
        me.getReference('canvas')?.measureQuiet()
    }

    /**
     * @summary Hands a click anywhere on Home to the field. A click on the operator line's merge count
     * asks for the fleet head's merge queue instead (`mergeQueueOpen`), one on its question count for the
     * Mailbox's open questions (`questionsOpen`).
     * @param {Object} data
     */
    onFieldClick(data) {
        const link = data.path?.find(node => node.cls?.includes('fm-home-operator-link'));

        if (link) {
            this.fire(link.cls.includes('is-questions') ? 'questionsOpen' : 'mergeQueueOpen');
            return
        }

        this.getReference('canvas')?.onClick(data)
    }

    /**
     * @summary The pointer left Home: the field forgets it.
     * @param {Object} data
     */
    onFieldLeave(data) {
        this.getReference('canvas')?.onMouseLeave(data)
    }

    /**
     * @summary Hands a pointer move anywhere on Home to the field.
     * @param {Object} data
     */
    onFieldMove(data) {
        this.getReference('canvas')?.onMouseMove(data)
    }
}

export default Neo.setupClass(Container);
