/**
 * @summary The first-run recipe's sample answers for the setup card's witnesses — the CLI's `--json`
 * for a cold run on the placement probe's own fixture host (a 32 GiB laptop: 14 GiB of other use, a
 * 16 GiB Docker VM), the probe's budgets, and the preset table's three rows as `placementPresets`
 * declares them. Every step row is the recipe's own output shape; nothing here is a hand-written
 * status the renderer could mistake for truth. Shared by the unit, e2e and visual tiers.
 */

export const GiB = 1073741824;

/**
 * The fixture plane's footprint every preset carries (`placementPresets.FIXTURE_PLANE`).
 * @type {Object}
 */
const FIXTURE_PLANE = {planeIdleBytes: Math.round(0.39 * GiB), planePeakBytes: Math.round(2.5 * GiB)};

/**
 * The preset table's facts a card shows.
 * @type {Object[]}
 */
export const samplePresets = [
    {id: 'hosted',      label: 'Hosted inference (Gemini)',    inference: 'hosted', chatModel: 'gemini-3.5-flash',      embedder: 'gemini-embedding-001', vectorDimension: 3072, workload: {...FIXTURE_PLANE, modelsBytes: 0},           qualityFloor: null,                       requires: ['providerKey', 'pat']},
    {id: 'local-small', label: 'Local inference, small index', inference: 'local',  chatModel: 'google/gemma-4-26b-a4b', embedder: 'qwen3-embedding-0.6b', vectorDimension: 1024, workload: {...FIXTURE_PLANE, modelsBytes: 15.2 * GiB}, qualityFloor: {measuredAt: '2026-10-02'}, requires: ['pat']},
    {id: 'local-full',  label: 'Local inference, full index',  inference: 'local',  chatModel: 'google/gemma-4-26b-a4b', embedder: 'qwen3-embedding-8b',   vectorDimension: 4096, workload: {...FIXTURE_PLANE, modelsBytes: 18.9 * GiB}, qualityFloor: {measuredAt: '2026-10-02'}, requires: ['pat']}
];

/**
 * The placement probe's JSON for the fixture host.
 * @type {Object}
 */
export const sampleProbe = {
    host        : {totalBytes: 32 * GiB, availableBytes: 15.5 * GiB, pressure: 'ok', complete: true},
    guest       : {capBytes: 16 * GiB, availableBytes: 13.5 * GiB, complete: true},
    runningPlane: null
};

/**
 * The placement step's verdicts on that host, each with the margins the recipe computed.
 * @type {Object}
 */
export const samplePlacement = {
    recommended  : [],
    possible     : [{id: 'hosted', margins: {host: 13 * GiB, guest: 11 * GiB}, reason: 'no recorded quality floor: a candidate, never recommended by default'}],
    refused      : [
        {id: 'local-small', margins: {host: -2.2 * GiB, guest: 5.5 * GiB}, reason: 'the host budget falls 2.2 GiB short'},
        {id: 'local-full',  margins: {host: -5.9 * GiB, guest: 5.5 * GiB}, reason: 'the host budget falls 5.9 GiB short'}
    ],
    headroomBytes: 4 * GiB
};

/**
 * One row in the recipe's step shape.
 * @param {String} id
 * @param {String} kind
 * @param {String} status
 * @param {String} reason
 * @param {Object} [extra={}]
 * @returns {Object}
 */
export const sampleStep = (id, kind, status, reason, extra = {}) => ({id, kind, status, reason, summary: `${id} summary`, ...extra});

/**
 * @summary The CLI's cold `--json` for the fixture host: two rows observed ok, nothing consented,
 * nothing written. A fresh object per call, so a witness can mutate its own copy.
 * @returns {Object}
 */
export function sampleColdEvaluation() {
    return {
        runId: '11111111-1111-4111-8111-111111111111', recordPath: '/tmp/setup/1.json', recipeVersion: 1,
        target: {planeId: null, dataRoot: null, endpoint: null}, binding: 'bound', bindingReason: null,
        steps: [
            sampleStep('placement',        'observation', 'ok',      'nothing recommended; possible: hosted (no recorded quality floor: a candidate, never recommended by default); refused: local-small (the host budget falls 2.2 GiB short), local-full (the host budget falls 5.9 GiB short)', {placement: samplePlacement, observedAt: '2026-10-02T10:00:00.000Z'}),
            sampleStep('preset',           'question',    'pending', 'unanswered', {answer: null}),
            sampleStep('plane-credential', 'question',    'pending', 'unanswered', {answer: null}),
            sampleStep('provider-key',     'question',    'pending', 'decided by the preset: none consented yet', {answer: null}),
            sampleStep('advanced',         'question',    'ok',      'folded: defaults apply', {answer: null}),
            sampleStep('write-env',        'effect',      'pending', '~/.neo-ai/config/local-agent-os.env does not exist', {effectId: 'write-env', receipt: null}),
            sampleStep('write-secrets',    'effect',      'pending', 'no secret files under ~/.neo-ai/secrets', {effectId: 'write-secrets', receipt: null}),
            sampleStep('compose-up',       'effect',      'pending', 'the compose project is not running', {effectId: 'compose-up', receipt: null}),
            sampleStep('served-plane',     'observation', 'unknown', 'connection refused'),
            sampleStep('validation',       'observation', 'unknown', 'no plane to ask'),
            sampleStep('done',             'observation', 'unknown', 'no plane to ask')
        ],
        terminal: sampleStep('done', 'observation', 'unknown', 'no plane to ask')
    }
}

/**
 * @summary The page-side `window.neoShell` a served cockpit witness installs before the app boots
 * (`page.addInitScript`): a packaged, unconfigured shell whose setup channels answer the cold
 * recipe. Serialized as source, since it runs in the page before any module loads. The credential
 * channel answers a kept file's PATH; no value ever enters the page.
 * @returns {String} The script source
 */
export function sampleShellInitScript() {
    return `
        (() => {
            const presets = ${JSON.stringify(samplePresets)};
            const probe   = ${JSON.stringify(sampleProbe)};
            const cold    = () => (${JSON.stringify(sampleColdEvaluation())});
            const calls   = [];
            let current   = cold();

            const consent = (stepId, answer) => {
                const step = current.steps.find(row => row.id === stepId);
                step.status = 'ok'; step.reason = 'consented'; step.answer = answer; step.consentedAt = '2026-10-02T10:22:00.000Z';
                if (stepId === 'preset') {
                    const key = current.steps.find(row => row.id === 'provider-key');
                    key.status = answer === 'hosted' ? 'pending' : 'ok';
                    key.reason = answer === 'hosted' ? 'unanswered' : "not needed: the '" + answer + "' preset requires no providerKey";
                }
            };

            window.__neoShellCalls = calls;
            window.neoShell = {
                planeStatus    : async () => ({attached: false, configured: false, packaged: true, planeBase: null}),
                verifyPlane    : async () => ({cause: null}),
                attachPlane    : async request => { calls.push(['attachPlane', request]); return {ok: false, reason: 'unreachable', relaunching: false} },
                setupEvaluate  : async request => { calls.push(['setupEvaluate', request]); return {ok: true, evaluation: current} },
                setupProbe     : async () => { calls.push(['setupProbe']); return {ok: true, probe} },
                setupPresets   : async () => { calls.push(['setupPresets']); return {ok: true, presets} },
                setupAnswer    : async ({stepId, answer}) => {
                    calls.push(['setupAnswer', {stepId, answer}]);
                    if (stepId === 'preset' && !presets.some(preset => preset.id === answer)) return {ok: false, reason: "'" + answer + "' is not a preset", stepId};
                    consent(stepId, answer);
                    return {ok: true, evaluation: current}
                },
                setupCredential: async ({stepId}) => {
                    calls.push(['setupCredential', {stepId}]);
                    consent(stepId, '/Users/op/.neo-ai/setup/credentials/' + stepId);
                    return {ok: true, evaluation: current, path: '/Users/op/.neo-ai/setup/credentials/' + stepId}
                },
                // the vessel's effect channel: the consented effect reads ok with an accepted receipt;
                // once the three effects are in, the served plane, the validation and done observe ok
                // (the fixture plane answering its first query and keeping its first memory)
                setupEffect    : async ({effectId}) => {
                    calls.push(['setupEffect', {effectId}]);

                    const step = current.steps.find(row => row.id === effectId);

                    if (!step) return {ok: false, reason: "'" + effectId + "' is not an effect of this recipe", effectId};

                    step.status = 'ok'; step.reason = 'observed; matches the accepted receipt'; step.receipt = 'accepted';

                    if (current.steps.filter(row => row.kind === 'effect').every(row => row.status === 'ok')) {
                        for (const [id, reason] of [['served-plane', 'served plane fixture-plane at its data root'], ['validation', 'provider answered; embedding observed at 3072 dimensions'], ['done', 'a query was answered and a first memory persisted']]) {
                            const row = current.steps.find(step => step.id === id);
                            row.status = 'ok'; row.reason = reason;
                        }
                        current.terminal = current.steps.find(step => step.id === 'done');
                    }

                    return {ok: true, evaluation: current}
                }
            }
        })();
    `
}
