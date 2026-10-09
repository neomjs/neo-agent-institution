import {setup} from '../../../../../setup.mjs';

setup({
    neoConfig: {allowVdomUpdatesInTests: true, useDomApiRenderer: true, unitTestMode: true},
    appConfig: {name: 'SetupCreateContainerTest', isMounted: () => true, vnodeInitialising: false}
});

import {test, expect}  from '@playwright/test';
import path            from 'node:path';
import {pathToFileURL} from 'node:url';
import Neo             from '../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core       from '../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import                      '../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';
import BaseContainer   from '../../../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import StateProvider   from '../../../../../../../node_modules/neo.mjs/src/state/Provider.mjs';
import CreateContainer, {CLI_COMMAND, START_VERBS, countDensity, describeAsks, presetVerdict, recommendationText} from '../../../../../../../apps/agentos/view/setup/CreateContainer.mjs';
import SetupSteps      from '../../../../../../../apps/agentos/store/SetupSteps.mjs';
import {EXIT_VERBS, actionsFor} from '../../../../../../../apps/agentos/view/setup/StepList.mjs';
import {BRAIN_ROOT, MACHINES, TRUSTED, pinnedSetupHost} from '../../../../../fixture/pinnedSetupHost.mjs';

/**
 * The pinned recipe's own evaluation in each state of the witness row, on a scripted host: reached
 * through the broker, never written here.
 * @returns {Promise<Object>} `{waiting, ready, lost, searched, accepted, refused}`
 */
async function witnessStates() {
    const
        states   = {},
        consents = async ({broker}) => {
            await broker.evaluate(TRUSTED, {});
            await broker.answer(TRUSTED, {stepId: 'preset', answer: 'local-small'});
            await broker.credential(TRUSTED, {stepId: 'plane-credential'});

            return (await broker.evaluate(TRUSTED, {})).evaluation
        },
        effects  = async ({broker}, request = {}) => {
            let reply;

            for (const effectId of ['write-secrets', 'write-env', 'compose-up', 'verify']) {
                reply = await broker.effect(TRUSTED, effectId === 'verify' ? {effectId, ...request} : {effectId})
            }

            return reply.evaluation
        },
        lostRun    = await pinnedSetupHost(),
        refusedRun = await pinnedSetupHost();

    states.waiting = await consents(lostRun);

    // the acknowledgement never arrives and no row lands; the second request searches and finds none
    lostRun.world.dropWrite = true;
    states.lost     = await effects(lostRun);
    states.searched = (await lostRun.broker.effect(TRUSTED, {effectId: 'verify'})).evaluation;

    lostRun.world.dropWrite   = false;
    lostRun.world.recallLands = true;
    states.accepted = (await lostRun.broker.effect(TRUSTED, {effectId: 'verify', newAttempt: true})).evaluation;

    await consents(refusedRun);
    refusedRun.world.refuseWrite = true;
    states.refused = await effects(refusedRun);

    return states
}

// the pinned recipe's own answers on the scripted laptop host: a cold run, the preset table, the probe
const
    HOST           = await pinnedSetupHost({machine: MACHINES.laptop}),
    COLD           = (await HOST.broker.evaluate(TRUSTED, {})).evaluation,
    PRESETS        = (await HOST.broker.presets(TRUSTED, {})).presets,
    PROBE          = (await HOST.broker.probe(TRUSTED, {})).probe,
    PLACEMENT      = COLD.steps.find(step => step.id === 'placement').placement,
    WITNESS        = await witnessStates(),
    coldEvaluation = () => structuredClone(COLD),
    // the questions answered: write-secrets is the row to run, every effect after it waits
    consented      = () => structuredClone(WITNESS.waiting),
    // a row in the recipe's step shape, for the one state an arm constructs because no scripted host reaches it
    row            = (id, kind, status, reason, extra = {}) => ({id, kind, status, reason, summary: `${id} summary`, ...extra}),
    put            = (evaluation, replacement) => {
        evaluation.steps[evaluation.steps.findIndex(step => step.id === replacement.id)] = replacement;

        return evaluation
    };

/**
 * Installs a stand-in for the `WS/ShellPlane` main addon's setup remotes, recording every request.
 * Each remote answers from the `replies` map, or the no-shell refusal when the map lacks it.
 */
function stubShell(replies = {}) {
    const calls = [];

    Neo.ns('Neo.main.addon', true).ShellPlane = Object.fromEntries(['setupAnswer', 'setupCredential', 'setupEffect', 'setupEvaluate', 'setupPresets', 'setupProbe'].map(name => [name, async request => {
        calls.push([name, request]);

        const reply = replies[name];

        return typeof reply === 'function' ? reply(request) : (reply ?? {ok: false, reason: 'no-shell'})
    }]));

    return calls
}

/**
 * The door inside a host carrying the view root's provider keys, the way the Viewport declares them.
 */
function createDoor() {
    const host = Neo.create(BaseContainer, {
        windowId     : 7,
        stateProvider: {module: StateProvider, data: {
            setupProgress: {blocking: null, next: null, ok: null, total: null},
            setupRun     : {dataRoot: null, decisions: null, manualActions: null, planeId: null, preset: null, recipeVersion: null, runId: null}
        }},
        items        : [{module: CreateContainer, reference: 'create-door'}]
    });

    const provider = host.getStateProvider();

    // the provider's data is a tree of leaves: read the block leaf by leaf
    const block = (name, keys) => Object.fromEntries(keys.map(key => [key, provider.getData(`${name}.${key}`)]));

    return {
        host,
        door    : host.getReference('create-door'),
        provider,
        progress: () => block('setupProgress', ['ok', 'total', 'next', 'blocking']),
        run     : () => block('setupRun', ['runId', 'recipeVersion', 'preset', 'planeId', 'dataRoot', 'decisions', 'manualActions'])
    }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test.describe('AgentOS.view.setup.CreateContainer — the recipe projected inline, never stored', () => {
    test.afterEach(() => {
        delete Neo.main?.addon?.ShellPlane
    });

    test('a cold run: every row is the evaluation\'s own status and reason, the progress counts ok rows only, nothing is green from a receipt', async () => {
        stubShell({setupEvaluate: {ok: true, evaluation: coldEvaluation()}, setupProbe: {ok: true, probe: PROBE}, setupPresets: {ok: true, presets: PRESETS}});

        const {host, door, progress, run} = createDoor();

        await settle();

        expect(door.store.getCount()).toBe(12);
        // the store is the evaluation, row for row and in its order; the order itself is the recipe's to state
        expect(door.store.items.map(step => `${step.id}:${step.status}`)).toEqual(COLD.steps.map(step => `${step.id}:${step.status}`));
        expect(door.store.items.map(step => `${step.id}:${step.status}`)).toEqual(expect.arrayContaining(['placement:ok', 'preset:pending', 'advanced:ok', 'compose-up:pending', 'verify:pending', 'done:unknown']));
        expect(door.store.get('served-plane').reason, 'the reason is the recipe\'s text verbatim').toBe('connect ECONNREFUSED 127.0.0.1:3102');
        expect(progress()).toEqual({ok: 2, total: 12, next: 'preset', blocking: null});
        // nothing decided yet: the advanced fold is a default, never a decision; the plane is the run's own
        // binding, there from the first evaluation because the broker binds the profile's
        expect(COLD.target.planeId, 'the cold run names its plane').toBeTruthy();
        expect(run()).toEqual({runId: COLD.runId, recipeVersion: 1, preset: null, planeId: COLD.target.planeId, dataRoot: COLD.target.dataRoot, decisions: 0, manualActions: 0});
        expect(door.getReference('quiet-line').hidden).toBe(true);
        expect(door.getReference('served').hidden, 'a shell answered: the served path stays hidden').toBe(true);

        // a receipt alone never greens a row: a row that carries an accepted receipt and reads
        // unknown renders unknown, and the progress does not count it
        const stale = coldEvaluation();

        put(stale, row('write-env', 'effect', 'unknown', 'the carrier could not be read', {effectId: 'write-env', receipt: 'accepted'}));
        door.evaluation = stale;

        expect(door.store.get('write-env').status).toBe('unknown');
        expect(door.store.get('write-env').receipt).toBe('accepted');
        expect(progress()).toEqual({ok: 2, total: 12, next: 'preset', blocking: null});

        host.destroy()
    });

    test('the three blocks read in order: the token open first; where it runs carries the recipe\'s recommendation, both budgets, and three choices under a fold (a refused one visible, disabled, with its shortfall); the credential as a window, then its block answered', async () => {
        const calls = stubShell({
            setupEvaluate  : {ok: true, evaluation: coldEvaluation()},
            setupProbe     : {ok: true, probe: PROBE},
            setupPresets   : {ok: true, presets: PRESETS},
            setupCredential: () => {
                const evaluation = coldEvaluation();

                put(evaluation, row('plane-credential', 'question', 'ok', 'consented', {answer: '/Users/op/.neo-ai/setup/credentials/plane-credential', consentedAt: '2026-10-02T10:22:00.000Z'}));
                return {ok: true, evaluation, path: '/Users/op/.neo-ai/setup/credentials/plane-credential'}
            }
        });

        const {host, door} = createDoor();

        await settle();

        // cold: the token is the open block, the other two are next; the Start block has no row yet
        expect(describeAsks(door.store)).toEqual({token: 'open', where: 'next', start: 'next', startRow: null});
        expect(door.getReference('ask-token').cls).toContain('is-open');
        expect(door.getReference('ask-where').cls).toContain('is-next');
        expect(door.getReference('token-change').hidden).toBe(true);
        expect(door.getReference('credential-button').text).toBe('Enter your token');
        expect(door.getReference('start-button').hidden).toBe(true);

        // where it runs: the recipe's recommendation in its own words, the budgets as the help, the choices folded
        expect(door.getReference('placement-line').text).toBe(`This machine, ${PRESETS[0].label} — fits with 13.0 GiB host margin (headroom 4.0 GiB)`);
        expect(door.getReference('use-button')).toMatchObject({hidden: false, presetId: 'hosted', text: `Use ${PRESETS[0].label}`});
        expect(door.getReference('budget-line').text).toBe('host 32.0 GiB total · 15.5 GiB available · pressure ok · VM 16.0 GiB cap · 13.5 GiB available');
        expect(door.getReference('presets').hidden, 'a recommendation folds the choices').toBe(true);
        expect(door.getReference('provider-key-button').hidden, 'no preset chosen: no key asked').toBe(true);

        door.onOtherChoicesClick();
        expect(door.getReference('presets').hidden).toBe(false);
        expect(door.getReference('other-choices-toggle').text).toBe('Fewer choices');

        const cards = door.getReference('presets').items;

        expect(cards.map(card => card.presetId)).toEqual(['hosted', 'local-small', 'local-full']);
        expect(cards.map(card => card.items[4].disabled), 'refused presets stay visible and disabled').toEqual([false, true, true]);
        expect(cards[1].items[3].text, 'a refused card names the shortfall, never a negative margin').toBe('refused — the host budget falls 2.2 GiB short');
        expect(cards[0].items[3].text, 'a recommended card carries its host margin').toBe('recommended — fits with 13.0 GiB host margin (headroom 4.0 GiB) · 13.0 GiB host margin');
        expect(cards[0].items[1].text, 'the table row, whatever the pin names').toBe(`chat ${PRESETS[0].chatModel} · embed ${PRESETS[0].embedder} · ${PRESETS[0].vectorDimension} dims`);
        expect(cards[0].items[2].text, 'the plane\'s own footprint').toBe('plane 0.4–2.5 GiB · no local models · needs a provider key');
        expect(cards[1].items[2].text, 'the floor is a receipt with a date').toBe('models 15.2 GiB · floor recorded 2026-10-02');
        // the provider key is asked only once the consented preset requires it: until then the row waits, as data
        expect(door.store.get('provider-key').waitsFor).toBe('preset');
        expect(actionsFor(door.store.get('provider-key'))).toEqual([]);

        // the PAT step opens main's window; the renderer holds the kept file's path and never a value
        await door.onCredentialClick();

        expect(calls.filter(([name]) => name === 'setupCredential')).toEqual([['setupCredential', {stepId: 'plane-credential', windowId: 7}]]);
        expect(door.getReference('credential-line').text).toBe('consented · /Users/op/.neo-ai/setup/credentials/plane-credential · 2026-10-02T10:22:00.000Z');
        expect(JSON.stringify(door.store.items.map(step => step.toJSON?.() ?? step))).not.toMatch(/ghp_|glpat-/);

        // the token answered: its block collapses to its line with Change, the next question opens
        expect(describeAsks(door.store)).toMatchObject({token: 'answered', where: 'open', start: 'next'});
        expect(door.getReference('ask-token').cls).toContain('is-answered');
        expect(door.getReference('token-change').hidden).toBe(false);
        expect(door.getReference('ask-where').cls).toContain('is-open');

        // Change opens the block again until the next evaluation — any fresh observation, equal or not
        door.onChangeClick({component: {askId: 'token'}});
        expect(door.getReference('ask-token').cls).toContain('is-open');
        door.evaluation = structuredClone(door.evaluation);
        expect(door.getReference('ask-token').cls, 'a fresh evaluation closes it').toContain('is-answered');

        host.destroy()
    });

    test('the recommendation sentence: the recipe\'s verdict and reason, the card\'s label; nothing recommended says so; no placement says it is measuring', () => {
        expect(recommendationText(PLACEMENT, PRESETS)).toBe(`This machine, ${PRESETS[0].label} — ${PLACEMENT.recommended[0].reason}`);
        expect(recommendationText({recommended: [], possible: [{id: 'hosted', reason: 'no recorded quality floor: a candidate, never recommended by default'}], refused: []}, PRESETS))
            .toBe(`Nothing fits this machine outright; ${PRESETS[0].label} is possible — no recorded quality floor: a candidate, never recommended by default. Choose under Other choices.`);
        expect(recommendationText({recommended: [], possible: [], refused: [{id: 'local-full', reason: 'short'}]}, PRESETS)).toBe('Nothing fits this machine yet — each choice says why under Other choices.');
        expect(recommendationText(null, PRESETS)).toBe('Measuring this machine…');
        // the verb map covers every chip verb a row can offer
        expect(Object.keys(START_VERBS).sort()).toEqual(['open memories', 're-check', 're-read', 'retry', 'run', 'which plane?', 'write again'].sort())
    });

    test('start: with both answers in, the Start block owns the first row that is not ok and waits for nothing; its button sends that row\'s own request; a costly write is said in the block first', async () => {
        let evaluation = consented();

        const calls = stubShell({
            setupEvaluate: () => ({ok: true, evaluation: structuredClone(evaluation)}),
            setupProbe   : {ok: true, probe: PROBE},
            setupPresets : {ok: true, presets: PRESETS},
            setupEffect  : () => ({ok: true, evaluation: structuredClone(evaluation)})
        });

        const {host, door} = createDoor();

        await settle();

        expect(describeAsks(door.store)).toMatchObject({token: 'answered', where: 'answered', start: 'open'});
        expect(describeAsks(door.store).startRow.id).toBe('write-secrets');
        expect(door.getReference('ask-start').cls).toContain('is-open');
        expect(door.getReference('placement-line').text).toBe(`This machine, ${PRESETS[1].label}`);
        expect(door.getReference('start-line').text).toBe(`${door.store.get('write-secrets').summary} · 5 of 12`);
        expect(door.getReference('start-help').text).toBe(`pending · ${door.store.get('write-secrets').reason}`);
        expect(door.getReference('start-button')).toMatchObject({hidden: false, text: 'Run next step'});

        await door.onStartClick();
        expect(calls.filter(([name]) => name === 'setupEffect').map(([, request]) => request)).toEqual([{effectId: 'write-secrets', windowId: 7}]);

        // the witness row where a second row is possible: the first press says so in the block
        evaluation = structuredClone(WITNESS.searched);
        await door.reevaluate('unused');
        expect(describeAsks(door.store).startRow.id).toBe('verify');
        expect(door.getReference('start-button').text).toBe('Check again');

        await door.onStepClick({action: 'write again', record: door.store.get('verify')});
        expect(door.getReference('start-help').text).toBe('a second row on the plane is possible · press Write again to write it');

        host.destroy()
    });

    test('choosing a preset is one consent, re-evaluated by main; a refusal lands on the status line and changes no row', async () => {
        const calls = stubShell({
            setupEvaluate: {ok: true, evaluation: coldEvaluation()},
            setupProbe   : {ok: true, probe: PROBE},
            setupPresets : {ok: true, presets: PRESETS},
            setupAnswer  : ({answer}) => {
                if (answer !== 'hosted') return {ok: false, reason: `'${answer}' is not a preset`, stepId: 'preset'};

                const evaluation = coldEvaluation();

                put(evaluation, row('preset', 'question', 'ok', 'consented', {answer: 'hosted', consentedAt: '2026-10-02T10:22:00.000Z'}));
                put(evaluation, row('provider-key', 'question', 'pending', 'unanswered', {answer: null}));
                return {ok: true, evaluation}
            }
        });

        const {host, door, progress, run} = createDoor();

        await settle();
        await door.onPresetClick({component: {presetId: 'hosted'}});

        expect(calls.filter(([name]) => name === 'setupAnswer')).toEqual([['setupAnswer', {answer: 'hosted', stepId: 'preset', windowId: 7}]]);
        expect(door.store.get('preset').answer).toBe('hosted');
        expect(door.getReference('presets').items[0].items[4].text).toBe('chosen');
        expect(door.getReference('use-button').hidden, 'the recommended preset is the chosen one').toBe(true);
        // the hosted preset requires a key: the block says so and offers the window, the row too
        expect(door.getReference('placement-line').text).toBe(`This machine, ${PRESETS[0].label} · needs a provider key`);
        expect(door.getReference('provider-key-line')).toMatchObject({hidden: false, text: 'This preset needs a provider key — unanswered'});
        expect(door.getReference('provider-key-button').hidden).toBe(false);
        expect(describeAsks(door.store).where, 'not answered until the key is kept').not.toBe('answered');
        expect(actionsFor(door.store.get('provider-key')), 'the hosted preset requires a key: the row gets its window').toEqual(['open window']);
        expect(run().preset).toBe('hosted');
        expect(progress()).toEqual({ok: 3, total: 12, next: 'plane-credential', blocking: null});

        await door.onPresetClick({component: {presetId: 'nope'}});

        expect(door.getReference('status-line').text).toBe('The preset \'nope\' was refused: \'nope\' is not a preset');
        expect(door.store.get('preset').answer, 'a refusal changes no row').toBe('hosted');

        host.destroy()
    });

    test('resume: an interrupted effect renders reconcile-required with re-check as its action and no replay; a served mismatch asks which plane', async () => {
        const evaluation = coldEvaluation();

        put(evaluation, row('write-env',    'effect',      'reconcile-required', 'the effect may have run before its receipt was written; a fresh matching observation settles it', {effectId: 'write-env', receipt: 'pending', observed: {present: true, digest: 'abc'}}));
        put(evaluation, row('write-secrets', 'effect',     'ok', 'observed; matches the accepted receipt', {effectId: 'write-secrets', receipt: 'accepted'}));
        put(evaluation, row('served-plane', 'observation', 'failed', 'served plane id is \'other-plane\', expected \'outside-plane\': a different plane is answering', {served: {planeId: 'other-plane', dataRoot: '/srv/other'}}));
        evaluation.target    = {planeId: 'outside-plane', dataRoot: '/Users/op/.neo-ai/plane', endpoint: 'http://127.0.0.1:3102'};

        const calls = stubShell({setupEvaluate: {ok: true, evaluation}, setupProbe: {ok: true, probe: PROBE}, setupPresets: {ok: true, presets: PRESETS}});
        const {host, door, progress, run} = createDoor();

        await settle();

        expect(actionsFor(door.store.get('write-env'))).toEqual(['re-check']);
        expect(actionsFor(door.store.get('write-secrets')), 'an ok effect offers no replay').toEqual([]);
        expect(progress()).toEqual({ok: 3, total: 12, next: 'preset', blocking: 'write-env'});
        expect(run()).toMatchObject({planeId: 'outside-plane', dataRoot: '/Users/op/.neo-ai/plane'});
        expect(door.getReference('lede').text).toContain(`Resumed from the run record (${COLD.runId}, bound to outside-plane at /Users/op/.neo-ai/plane)`);

        // re-check is a fresh evaluation, never an effect call
        await door.onStepClick({record: door.store.get('write-env')});
        expect(calls.map(([name]) => name).filter(name => name === 'setupEffect')).toEqual([]);
        expect(calls.filter(([name]) => name === 'setupEvaluate').length).toBe(2);

        await door.onStepClick({record: door.store.get('served-plane')});
        expect(door.getReference('status-line').text).toBe('the served plane is \'other-plane\' at /srv/other; the target is \'outside-plane\'');

        host.destroy()
    });

    test('run: an effect the shell cannot run becomes the operator\'s instruction, counted as a manual action; a shell that runs it answers the fresh evaluation', async () => {
        let wired = false;

        const calls = stubShell({
            setupEvaluate: {ok: true, evaluation: consented()},
            setupProbe   : {ok: true, probe: PROBE},
            setupPresets : {ok: true, presets: PRESETS},
            setupEffect  : ({effectId}) => {
                if (!wired) return {ok: false, reason: 'no-brain-root: the preset\'s env set has no config to be checked against', effectId};

                const evaluation = consented();

                put(evaluation, row('write-secrets', 'effect', 'ok', 'observed; matches the accepted receipt', {effectId: 'write-secrets', receipt: 'accepted'}));
                return {ok: true, evaluation}
            }
        });

        const {host, door} = createDoor();

        await settle();

        // a row that waits for another step has no action: a click on it sends nothing
        expect(door.store.get('write-env').waitsFor).toBe('write-secrets');
        await door.onStepClick({record: door.store.get('write-env')});
        expect(calls.filter(([name]) => name === 'setupEffect')).toEqual([]);

        await door.onStepClick({record: door.store.get('write-secrets')});

        expect(calls.filter(([name]) => name === 'setupEffect')).toEqual([['setupEffect', {effectId: 'write-secrets', windowId: 7}]]);
        expect(door.getReference('status-line').text).toBe(`write-secrets: no-brain-root: the preset's env set has no config to be checked against — run \`${CLI_COMMAND.replace(' --json', '')}\` on the host, then re-check`);
        expect(door.manualActions).toBe(1);
        expect(door.store.get('write-secrets').status, 'nothing changed locally').toBe('pending');

        wired = true;
        await door.onStepClick({record: door.store.get('write-secrets')});

        expect(door.store.get('write-secrets').status).toBe('ok');
        expect(door.getReference('status-line').text).toBe('');

        host.destroy()
    });

    test('run: a refusal from the orchestration is the shell\'s own word on the effect — the status line speaks, no manual action, the last observation stands', async () => {
        stubShell({
            setupEvaluate: {ok: true, evaluation: consented()},
            setupProbe   : {ok: true, probe: PROBE},
            setupPresets : {ok: true, presets: PRESETS},
            setupEffect  : ({effectId}) => ({ok: false, reason: 'the preset \'hosted\' declares an env key the profile does not consume', effectId})
        });

        const {host, door, progress} = createDoor();

        await settle();
        await door.onStepClick({record: door.store.get('write-secrets')});

        expect(door.getReference('status-line').text).toBe('write-secrets could not run: the preset \'hosted\' declares an env key the profile does not consume');
        expect(door.manualActions).toBe(0);
        expect(door.store.get('write-secrets').status).toBe('pending');
        expect(progress()).toEqual({ok: 5, total: 12, next: 'write-secrets', blocking: null});

        host.destroy()
    });

    test('the witness row offers what its data names: a wait, run, re-check, write again, both in the Brain\'s order, nothing once accepted; the verbs cover exactly the pinned Brain\'s exits', async () => {
        const
            {VERIFY_EXITS} = await import(pathToFileURL(path.join(BRAIN_ROOT, 'ai/services/fleet/verifyEffect.mjs')).href),
            store          = Neo.create(SetupSteps, {}),
            offered        = evaluation => { store.projectEvaluation(evaluation); return actionsFor(store.get('verify')) };

        expect(Object.keys(EXIT_VERBS).sort(), 'one verb per exit the Brain can name').toEqual(Object.values(VERIFY_EXITS).sort());

        expect(offered(WITNESS.waiting), 'it waits for write-secrets: no chip, whatever exit it names').toEqual([]);
        expect(store.get('verify')).toMatchObject({waitsFor: 'write-secrets', exits: ['run']});
        expect(offered(WITNESS.refused)).toEqual(['write again']);
        expect(store.get('verify').duplicatePossible, 'a refused write minted no row').toBe(false);
        expect(offered(WITNESS.lost)).toEqual(['re-check']);
        expect(offered(WITNESS.searched)).toEqual(['re-check', 'write again']);
        expect(store.get('verify').duplicatePossible).toBe(true);
        expect(offered(WITNESS.accepted)).toEqual([]);

        // constructed: the row before its first attempt once nothing is in its way, and wire values of another type
        expect(actionsFor({id: 'verify', kind: 'effect', status: 'pending', waitsFor: null, exits: ['run']})).toEqual(['run']);
        expect(actionsFor({id: 'verify', kind: 'effect', status: 'failed', exits: ['an-exit-of-tomorrow']}), 'an exit without a verb shows no chip').toEqual([]);
        store.projectEvaluation({steps: [{id: 'verify', kind: 'effect', status: 'pending', waitsFor: 7, exits: 'run', duplicatePossible: 'yes'}]});
        expect(store.get('verify')).toMatchObject({waitsFor: null, exits: null, duplicatePossible: false});

        store.destroy()
    });

    test('the witness row\'s clicks: re-check is its effect without a new attempt; write again after a refused write sends at once; where a second row is possible the first press says so in the row and the second sends', async () => {
        let evaluation = structuredClone(WITNESS.searched);

        const calls = stubShell({
            setupEvaluate: () => ({ok: true, evaluation: structuredClone(evaluation)}),
            setupProbe   : {ok: true, probe: PROBE},
            setupPresets : {ok: true, presets: PRESETS},
            setupEffect  : () => ({ok: true, evaluation: structuredClone(evaluation)})
        });

        const
            {host, door} = createDoor(),
            list         = door.getReference('step-list'),
            effects      = () => calls.filter(([name]) => name === 'setupEffect').map(([, request]) => request),
            cells        = () => list.createItemContent(door.store.get('verify'));

        await settle();

        // two chips, the second the quieter one; the reason is the Brain's own warning
        expect(cells()[4].cn.map(chip => [chip.text, chip.cls.includes('is-quiet')])).toEqual([['re-check', false], ['write again', true]]);
        expect(cells()[3].text).toContain('consent to a new attempt writes a second row');

        // a click beside the chips is the row's first action
        await door.onStepClick({action: null, record: door.store.get('verify')});
        expect(effects(), 're-check resumes the effect and names no new attempt').toEqual([{effectId: 'verify', windowId: 7}]);

        await door.onStepClick({action: 'write again', record: door.store.get('verify')});
        expect(effects().length, 'the first press sends nothing').toBe(1);
        expect(list.confirmingId).toBe('verify');
        expect(cells()[5]).toMatchObject({cls: ['fm-setup-step-confirm'], text: expect.stringContaining('a second row on the plane is possible')});

        await door.onStepClick({action: 'write again', record: door.store.get('verify')});
        expect(effects().at(-1), 'the second press is the consent').toEqual({effectId: 'verify', newAttempt: true, windowId: 7});
        expect(list.confirmingId).toBe(null);
        expect(cells().length).toBe(5);

        // the first press is taken back by any other click, here a row whose click sends nothing
        await door.onStepClick({action: 'write again', record: door.store.get('verify')});
        await door.onStepClick({record: door.store.get('write-secrets')});
        expect(list.confirmingId).toBe(null);

        // and by any fresh evaluation, whichever control asked for it: an answer equal to the held one
        await door.onStepClick({action: 'write again', record: door.store.get('verify')});
        const equal = structuredClone(door.evaluation);
        expect(Neo.isEqual(equal, door.evaluation), 'the control is an equal answer').toBe(true);
        door.evaluation = equal;
        expect(list.confirmingId, 'an equal answer is an observation too').toBe(null);
        expect(cells().length).toBe(5);

        // and a changed one
        await door.onStepClick({action: 'write again', record: door.store.get('verify')});
        const changed = structuredClone(door.evaluation);
        changed.steps[0].reason = 'another reason';
        expect(Neo.isEqual(changed, door.evaluation), 'the control is a changed answer').toBe(false);
        door.evaluation = changed;
        expect(list.confirmingId).toBe(null);
        expect(effects().length, 'none of the three took the write').toBe(2);

        // a refused write minted no row: nothing to confirm, one press sends it
        evaluation = structuredClone(WITNESS.refused);
        await door.reevaluate('unused');
        await door.onStepClick({record: door.store.get('verify')});
        expect(effects().slice(2)).toEqual([{effectId: 'verify', newAttempt: true, windowId: 7}]);
        expect(list.confirmingId).toBe(null);

        // a waiting row says which step it waits for, in place of a chip
        evaluation = structuredClone(WITNESS.waiting);
        await door.reevaluate('unused');
        expect(cells()[4].cn).toEqual([{cls: ['fm-setup-step-wait'], text: 'waits for write-secrets'}]);

        host.destroy()
    });

    test('first persistence: the quiet confirmation is the done row\'s own text, fired once with the density count; a repeated evaluation does not fire again', async () => {
        const finished = coldEvaluation();

        finished.steps = finished.steps.map(step => step.kind === 'question'
            ? row(step.id, 'question', 'ok', step.id === 'advanced' ? 'folded: defaults apply' : 'consented', {answer: step.id === 'advanced' ? null : step.id === 'preset' ? 'local-small' : `/kept/${step.id}`})
            : step.kind === 'effect'
                ? row(step.id, 'effect', 'ok', 'observed; matches the accepted receipt', {effectId: step.effectId, receipt: 'accepted'})
                : row(step.id, 'observation', 'ok', step.id === 'done' ? 'a query was answered and a first memory persisted' : 'observed'));
        finished.terminal = finished.steps.find(step => step.id === 'done');

        stubShell({setupEvaluate: {ok: true, evaluation: finished}, setupProbe: {ok: true, probe: PROBE}, setupPresets: {ok: true, presets: PRESETS}});

        const fired = [];
        const {host, door, progress, run} = createDoor();

        door.on('firstPersistence', data => fired.push(data));
        await settle();

        expect(door.getReference('quiet-line').hidden).toBe(false);
        expect(door.getReference('quiet-line').text).toBe('a query was answered and a first memory persisted · local-small · 1024-dim · the set-up card stays in the rail');
        expect(progress()).toEqual({ok: 12, total: 12, next: null, blocking: null});
        expect(run()).toMatchObject({preset: 'local-small', decisions: 7, manualActions: 0});

        // the counting definition: three answered questions (the fold stays a default) + four
        // consented effects = 7 decisions, 0 manual actions on a host where every effect ran
        expect(countDensity(finished)).toEqual({decisions: 7, manualActions: 0});

        door.evaluation = {...finished};
        expect(fired, 'fired once, with the count').toEqual([{density: {decisions: 7, manualActions: 0}, evaluation: expect.any(Object), source: door.id}]);

        host.destroy()
    });

    test('served cockpit (no shell): the door shows the CLI\'s command and projects a pasted evaluation through the same list; a non-evaluation is refused in words', async () => {
        const {host, door} = createDoor();

        await settle();

        expect(door.shellAvailable).toBe(false);
        expect(door.getReference('served').hidden).toBe(false);
        expect(door.getReference('questions').hidden).toBe(true);
        expect(door.getReference('served').items[1].text).toBe(CLI_COMMAND);

        door.getReference('pasted-json').value = 'not json';
        door.onProjectPastedClick();
        expect(door.getReference('status-line').text).toMatch(/^That is not the command's JSON: /);
        expect(door.store.getCount()).toBe(0);

        door.getReference('pasted-json').value = JSON.stringify(coldEvaluation());
        door.onProjectPastedClick();
        expect(door.store.getCount()).toBe(12);
        expect(door.getReference('status-line').text).toBe('');

        host.destroy()
    });

    test('a failed observation after a green one: every row turns unknown with the read\'s reason and the progress drops; an action refusal keeps the last observation', async () => {
        let evaluateFails = false;

        stubShell({
            setupEvaluate: () => evaluateFails ? {ok: false, reason: 'the recipe modules did not load: ENOENT'} : {ok: true, evaluation: coldEvaluation()},
            setupProbe   : {ok: true, probe: PROBE},
            setupPresets : {ok: true, presets: PRESETS},
            setupAnswer  : {ok: false, reason: 'refused by the fixture', stepId: 'preset'}
        });

        const {host, door, progress} = createDoor();

        await settle();
        expect(progress()).toEqual({ok: 2, total: 12, next: 'preset', blocking: null});

        // an ACTION refusal: the status line speaks, the observation stands
        await door.onPresetClick({component: {presetId: 'hosted'}});
        expect(door.getReference('status-line').text).toBe('The preset \'hosted\' was refused: refused by the fixture');
        expect(door.store.get('placement').status).toBe('ok');
        expect(progress()).toEqual({ok: 2, total: 12, next: 'preset', blocking: null});

        // an OBSERVATION failure: no row stays green from the previous read
        evaluateFails = true;
        await door.onStepClick({record: door.store.get('placement')});   // re-read

        expect(door.getReference('status-line').text).toBe('The recipe could not be re-evaluated: the recipe modules did not load: ENOENT');
        expect(door.store.items.every(step => step.status === 'unknown')).toBe(true);
        expect(door.store.get('placement').reason).toBe('The recipe could not be re-evaluated: the recipe modules did not load: ENOENT');
        expect(progress()).toEqual({ok: 0, total: 12, next: 'placement', blocking: null});
        expect(door.getReference('quiet-line').hidden).toBe(true);

        host.destroy()
    });

    test('a slow refresh never overwrites a newer consent\'s reply: the older observation is dropped', async () => {
        const
            releases = [],
            answered = coldEvaluation();

        put(answered, row('preset', 'question', 'ok', 'consented', {answer: 'hosted', consentedAt: '2026-10-02T10:22:00.000Z'}));
        let evaluations = 0;

        stubShell({
            // the first evaluation (the mount's refresh) answers at once; the second (a re-read)
            // waits until the test releases it, after a preset consent has been admitted
            setupEvaluate: () => ++evaluations === 1 ? {ok: true, evaluation: coldEvaluation()} : new Promise(resolve => releases.push(() => resolve({ok: true, evaluation: coldEvaluation()}))),
            setupProbe   : {ok: true, probe: PROBE},
            setupPresets : {ok: true, presets: PRESETS},
            setupAnswer  : {ok: true, evaluation: answered}
        });

        const {host, door, progress} = createDoor();

        await settle();

        const slowRead = door.onStepClick({record: door.store.get('placement')});   // re-read, held

        await door.onPresetClick({component: {presetId: 'hosted'}});
        expect(door.store.get('preset').answer, 'the consent is admitted while the read is in flight').toBe('hosted');

        releases.shift()();
        await slowRead;

        expect(door.store.get('preset').answer, 'the older read does not win').toBe('hosted');
        expect(progress()).toEqual({ok: 3, total: 12, next: 'plane-credential', blocking: null});

        host.destroy()
    });

    test('the store\'s progress and the preset verdict helper read the rows alone', () => {
        const store = Neo.create(SetupSteps, {});

        expect(store.projectEvaluation(coldEvaluation())).toBe(12);
        expect(store.describeProgress()).toEqual({ok: 2, total: 12, next: 'preset', blocking: null});
        expect(store.projectEvaluation(null), 'no steps clears the list').toBe(0);
        expect(store.describeProgress()).toEqual({ok: 0, total: 0, next: null, blocking: null});
        expect(presetVerdict(PLACEMENT, 'local-full')).toMatchObject({verdict: 'refused', reason: 'the host budget falls 5.9 GiB short'});
        expect(presetVerdict(PLACEMENT, 'hosted')).toMatchObject({verdict: 'recommended', margins: PLACEMENT.recommended[0].margins});
        // an adverse placement, constructed: a candidate without a recorded floor reads possible, with its reason
        expect(presetVerdict({recommended: [], possible: [{id: 'hosted', margins: {host: 1, guest: 1}, reason: 'no recorded quality floor: a candidate, never recommended by default'}], refused: []}, 'hosted'))
            .toMatchObject({verdict: 'possible', reason: 'no recorded quality floor: a candidate, never recommended by default'});
        expect(presetVerdict(null, 'hosted')).toEqual({verdict: 'unknown', reason: 'the placement step has not answered', margins: null});

        store.destroy()
    })
});
