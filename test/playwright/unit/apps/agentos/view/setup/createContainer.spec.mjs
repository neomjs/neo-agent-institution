import {setup} from '../../../../../setup.mjs';

setup({
    neoConfig: {allowVdomUpdatesInTests: true, useDomApiRenderer: true, unitTestMode: true},
    appConfig: {name: 'SetupCreateContainerTest', isMounted: () => true, vnodeInitialising: false}
});

import {test, expect}  from '@playwright/test';
import Neo             from '../../../../../../../node_modules/neo.mjs/src/Neo.mjs';
import * as core       from '../../../../../../../node_modules/neo.mjs/src/core/_export.mjs';
import                      '../../../../../../../node_modules/neo.mjs/src/manager/Instance.mjs';
import BaseContainer   from '../../../../../../../node_modules/neo.mjs/src/container/Base.mjs';
import StateProvider   from '../../../../../../../node_modules/neo.mjs/src/state/Provider.mjs';
import CreateContainer, {CLI_COMMAND, countDensity, presetVerdict} from '../../../../../../../apps/agentos/view/setup/CreateContainer.mjs';
import SetupSteps      from '../../../../../../../apps/agentos/store/SetupSteps.mjs';
import {actionFor}     from '../../../../../../../apps/agentos/view/setup/StepList.mjs';
import {sampleColdEvaluation, samplePlacement, samplePresets, sampleProbe, sampleStep} from '../../../../../fixture/setupRecipeSample.mjs';

// the recipe's sample answers for the fixture host (shared with the e2e and visual tiers)
const
    PRESETS        = samplePresets,
    PROBE          = sampleProbe,
    PLACEMENT      = samplePlacement,
    row            = sampleStep,
    coldEvaluation = sampleColdEvaluation;

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

        expect(door.store.getCount()).toBe(11);
        expect(door.store.items.map(step => `${step.id}:${step.status}`)).toEqual([
            'placement:ok', 'preset:pending', 'plane-credential:pending', 'provider-key:pending', 'advanced:ok',
            'write-env:pending', 'write-secrets:pending', 'compose-up:pending', 'served-plane:unknown', 'validation:unknown', 'done:unknown'
        ]);
        expect(door.store.get('served-plane').reason, 'the reason is the recipe\'s text verbatim').toBe('connection refused');
        expect(progress()).toEqual({ok: 2, total: 11, next: 'preset', blocking: null});
        // nothing decided yet: the advanced fold is a default, never a decision
        expect(run()).toEqual({runId: '11111111-1111-4111-8111-111111111111', recipeVersion: 1, preset: null, planeId: null, dataRoot: null, decisions: 0, manualActions: 0});
        expect(door.getReference('quiet-line').hidden).toBe(true);
        expect(door.getReference('served').hidden, 'a shell answered: the served path stays hidden').toBe(true);

        // a receipt alone never greens a row: a row that carries an accepted receipt and reads
        // unknown renders unknown, and the progress does not count it
        const stale = coldEvaluation();

        stale.steps[5] = row('write-env', 'effect', 'unknown', 'the carrier could not be read', {effectId: 'write-env', receipt: 'accepted'});
        door.evaluation = stale;

        expect(door.store.get('write-env').status).toBe('unknown');
        expect(door.store.get('write-env').receipt).toBe('accepted');
        expect(progress()).toEqual({ok: 2, total: 11, next: 'preset', blocking: null});

        host.destroy()
    });

    test('the three questions: both budgets from the probe, three preset cards with the placement\'s verdicts (a refused one visible, disabled, with its shortfall), the credential as a window', async () => {
        const calls = stubShell({
            setupEvaluate  : {ok: true, evaluation: coldEvaluation()},
            setupProbe     : {ok: true, probe: PROBE},
            setupPresets   : {ok: true, presets: PRESETS},
            setupCredential: () => {
                const evaluation = coldEvaluation();

                evaluation.steps[2] = row('plane-credential', 'question', 'ok', 'consented', {answer: '/Users/op/.neo-ai/setup/credentials/plane-credential', consentedAt: '2026-10-02T10:22:00.000Z'});

                return {ok: true, evaluation, path: '/Users/op/.neo-ai/setup/credentials/plane-credential'}
            }
        });

        const {host, door} = createDoor();

        await settle();

        expect(door.getReference('budget-line').text).toBe('host 32.0 GiB total · 15.5 GiB available · pressure ok · VM 16.0 GiB cap · 13.5 GiB available');

        const cards = door.getReference('presets').items;

        expect(cards.map(card => card.presetId)).toEqual(['hosted', 'local-small', 'local-full']);
        expect(cards.map(card => card.items[4].disabled), 'refused presets stay visible and disabled').toEqual([false, true, true]);
        expect(cards[1].items[3].text, 'a refused card names the shortfall, never a negative margin').toBe('refused — the host budget falls 2.2 GiB short');
        expect(cards[0].items[3].text, 'a possible card carries its host margin').toBe('possible — no recorded quality floor: a candidate, never recommended by default · 13.0 GiB host margin');
        expect(cards[0].items[1].text).toBe('chat gemini-3.5-flash · embed gemini-embedding-001 · 3072 dims');
        expect(cards[0].items[2].text, 'the plane\'s own footprint').toBe('plane 0.4–2.5 GiB · no local models · needs a provider key');
        expect(cards[1].items[2].text, 'the floor is a receipt with a date').toBe('models 15.2 GiB · floor recorded 2026-10-02');
        expect(door.getReference('placement-line').text).toBe('nothing recommended — each preset says why');
        // the provider key is asked only once the consented preset requires it
        expect(actionFor(door.store.get('provider-key'))).toBe(null);

        // the PAT step opens main's window; the renderer holds the kept file's path and never a value
        await door.onCredentialClick();

        expect(calls.filter(([name]) => name === 'setupCredential')).toEqual([['setupCredential', {stepId: 'plane-credential', windowId: 7}]]);
        expect(door.getReference('credential-line').text).toBe('consented · /Users/op/.neo-ai/setup/credentials/plane-credential · 2026-10-02T10:22:00.000Z');
        expect(door.getReference('credential-button').text).toBe('Change');
        expect(JSON.stringify(door.store.items.map(step => step.toJSON?.() ?? step))).not.toMatch(/ghp_|glpat-/);

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

                evaluation.steps[1] = row('preset', 'question', 'ok', 'consented', {answer: 'hosted', consentedAt: '2026-10-02T10:22:00.000Z'});
                evaluation.steps[3] = row('provider-key', 'question', 'pending', 'unanswered', {answer: null});

                return {ok: true, evaluation}
            }
        });

        const {host, door, progress, run} = createDoor();

        await settle();
        await door.onPresetClick({component: {presetId: 'hosted'}});

        expect(calls.filter(([name]) => name === 'setupAnswer')).toEqual([['setupAnswer', {answer: 'hosted', stepId: 'preset', windowId: 7}]]);
        expect(door.store.get('preset').answer).toBe('hosted');
        expect(door.getReference('presets').items[0].items[4].text).toBe('chosen');
        expect(door.getReference('provider-key-line').text).toBe('unanswered');
        expect(actionFor(door.store.get('provider-key')), 'the hosted preset requires a key: the row gets its window').toBe('open window');
        expect(run().preset).toBe('hosted');
        expect(progress()).toEqual({ok: 3, total: 11, next: 'plane-credential', blocking: null});

        await door.onPresetClick({component: {presetId: 'nope'}});

        expect(door.getReference('status-line').text).toBe('The preset \'nope\' was refused: \'nope\' is not a preset');
        expect(door.store.get('preset').answer, 'a refusal changes no row').toBe('hosted');

        host.destroy()
    });

    test('resume: an interrupted effect renders reconcile-required with re-check as its action and no replay; a served mismatch asks which plane', async () => {
        const evaluation = coldEvaluation();

        evaluation.steps[5]  = row('write-env',    'effect',      'reconcile-required', 'the effect may have run before its receipt was written; a fresh matching observation settles it', {effectId: 'write-env', receipt: 'pending', observed: {present: true, digest: 'abc'}});
        evaluation.steps[6]  = row('write-secrets', 'effect',     'ok', 'observed; matches the accepted receipt', {effectId: 'write-secrets', receipt: 'accepted'});
        evaluation.steps[8]  = row('served-plane', 'observation', 'failed', 'served plane id is \'other-plane\', expected \'outside-plane\': a different plane is answering', {served: {planeId: 'other-plane', dataRoot: '/srv/other'}});
        evaluation.target    = {planeId: 'outside-plane', dataRoot: '/Users/op/.neo-ai/plane', endpoint: 'http://127.0.0.1:3102'};

        const calls = stubShell({setupEvaluate: {ok: true, evaluation}, setupProbe: {ok: true, probe: PROBE}, setupPresets: {ok: true, presets: PRESETS}});
        const {host, door, progress, run} = createDoor();

        await settle();

        expect(actionFor(door.store.get('write-env'))).toBe('re-check');
        expect(actionFor(door.store.get('write-secrets')), 'an ok effect offers no replay').toBe(null);
        expect(progress()).toEqual({ok: 3, total: 11, next: 'preset', blocking: 'write-env'});
        expect(run()).toMatchObject({planeId: 'outside-plane', dataRoot: '/Users/op/.neo-ai/plane'});
        expect(door.getReference('lede').text).toContain('Resumed from the run record (11111111-1111-4111-8111-111111111111, bound to outside-plane at /Users/op/.neo-ai/plane)');

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
            setupEvaluate: {ok: true, evaluation: coldEvaluation()},
            setupProbe   : {ok: true, probe: PROBE},
            setupPresets : {ok: true, presets: PRESETS},
            setupEffect  : ({effectId}) => {
                if (!wired) return {ok: false, reason: 'unwired: the recipe\'s effect orchestration is the CLI\'s own', effectId};

                const evaluation = coldEvaluation();

                evaluation.steps[5] = row('write-env', 'effect', 'ok', 'observed; matches the accepted receipt', {effectId: 'write-env', receipt: 'accepted'});

                return {ok: true, evaluation}
            }
        });

        const {host, door} = createDoor();

        await settle();
        await door.onStepClick({record: door.store.get('write-env')});

        expect(calls.filter(([name]) => name === 'setupEffect')).toEqual([['setupEffect', {effectId: 'write-env', windowId: 7}]]);
        expect(door.getReference('status-line').text).toBe(`write-env: unwired: the recipe's effect orchestration is the CLI's own — run \`${CLI_COMMAND.replace(' --json', '')}\` on the host, then re-check`);
        expect(door.manualActions).toBe(1);
        expect(door.store.get('write-env').status, 'nothing changed locally').toBe('pending');

        wired = true;
        await door.onStepClick({record: door.store.get('write-env')});

        expect(door.store.get('write-env').status).toBe('ok');
        expect(door.getReference('status-line').text).toBe('');

        host.destroy()
    });

    test('first persistence: the quiet confirmation is the done row\'s own text, fired once with the density count; a repeated evaluation does not fire again', async () => {
        const finished = coldEvaluation();

        finished.steps = finished.steps.map(step => step.kind === 'question'
            ? row(step.id, 'question', 'ok', step.id === 'advanced' ? 'folded: defaults apply' : 'consented', {answer: step.id === 'advanced' ? null : step.id === 'preset' ? 'local-small' : `/kept/${step.id}`})
            : step.kind === 'effect'
                ? row(step.id, 'effect', 'ok', 'observed; matches the accepted receipt', {effectId: step.effectId, receipt: 'accepted'})
                : row(step.id, 'observation', 'ok', step.id === 'done' ? 'a query was answered and a first memory persisted' : 'observed'));
        finished.terminal = finished.steps[10];

        stubShell({setupEvaluate: {ok: true, evaluation: finished}, setupProbe: {ok: true, probe: PROBE}, setupPresets: {ok: true, presets: PRESETS}});

        const fired = [];
        const {host, door, progress, run} = createDoor();

        door.on('firstPersistence', data => fired.push(data));
        await settle();

        expect(door.getReference('quiet-line').hidden).toBe(false);
        expect(door.getReference('quiet-line').text).toBe('a query was answered and a first memory persisted · local-small · 1024-dim · the set-up card stays in the rail');
        expect(progress()).toEqual({ok: 11, total: 11, next: null, blocking: null});
        expect(run()).toMatchObject({preset: 'local-small', decisions: 6, manualActions: 0});

        // the counting definition: three answered questions (the fold stays a default) + three
        // consented effects = 6 decisions, 0 manual actions on a host where every effect ran
        expect(countDensity(finished)).toEqual({decisions: 6, manualActions: 0});

        door.evaluation = {...finished};
        expect(fired, 'fired once, with the count').toEqual([{density: {decisions: 6, manualActions: 0}, evaluation: expect.any(Object), source: door.id}]);

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
        expect(door.store.getCount()).toBe(11);
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
        expect(progress()).toEqual({ok: 2, total: 11, next: 'preset', blocking: null});

        // an ACTION refusal: the status line speaks, the observation stands
        await door.onPresetClick({component: {presetId: 'hosted'}});
        expect(door.getReference('status-line').text).toBe('The preset \'hosted\' was refused: refused by the fixture');
        expect(door.store.get('placement').status).toBe('ok');
        expect(progress()).toEqual({ok: 2, total: 11, next: 'preset', blocking: null});

        // an OBSERVATION failure: no row stays green from the previous read
        evaluateFails = true;
        await door.onStepClick({record: door.store.get('placement')});   // re-read

        expect(door.getReference('status-line').text).toBe('The recipe could not be re-evaluated: the recipe modules did not load: ENOENT');
        expect(door.store.items.every(step => step.status === 'unknown')).toBe(true);
        expect(door.store.get('placement').reason).toBe('The recipe could not be re-evaluated: the recipe modules did not load: ENOENT');
        expect(progress()).toEqual({ok: 0, total: 11, next: 'placement', blocking: null});
        expect(door.getReference('quiet-line').hidden).toBe(true);

        host.destroy()
    });

    test('a slow refresh never overwrites a newer consent\'s reply: the older observation is dropped', async () => {
        const
            releases = [],
            answered = coldEvaluation();

        answered.steps[1] = row('preset', 'question', 'ok', 'consented', {answer: 'hosted', consentedAt: '2026-10-02T10:22:00.000Z'});

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
        expect(progress()).toEqual({ok: 3, total: 11, next: 'plane-credential', blocking: null});

        host.destroy()
    });

    test('the store\'s progress and the preset verdict helper read the rows alone', () => {
        const store = Neo.create(SetupSteps, {});

        expect(store.projectEvaluation(coldEvaluation())).toBe(11);
        expect(store.describeProgress()).toEqual({ok: 2, total: 11, next: 'preset', blocking: null});
        expect(store.projectEvaluation(null), 'no steps clears the list').toBe(0);
        expect(store.describeProgress()).toEqual({ok: 0, total: 0, next: null, blocking: null});
        expect(presetVerdict(PLACEMENT, 'local-full')).toMatchObject({verdict: 'refused', reason: 'the host budget falls 5.9 GiB short'});
        expect(presetVerdict(PLACEMENT, 'hosted').margins).toEqual(PLACEMENT.possible[0].margins);
        expect(presetVerdict(null, 'hosted')).toEqual({verdict: 'unknown', reason: 'the placement step has not answered', margins: null});

        store.destroy()
    })
});
