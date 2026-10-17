import path from 'node:path';
import {buildPackagedBrainEnv, resolveBrainPaths, runBrainScript} from './brain.mjs';
import {readSeatRootRecord} from './seatRootRecord.mjs';
import {consentSeatMove, planSeatMove, readSeatRootMove, runSeatMoveStep} from './seatRootMove.mjs';

/**
 * @module harness/seatRootBroker
 * @summary Main-owned review and consent for this installation's seat placement. The renderer
 * returns a plan fingerprint; roots, move ownership and records stay with the shell. Every call
 * validates its sender, independently of whether the Fleet child could boot.
 */
export const SEAT_ROOT_CHANNELS = Object.freeze({
    status : 'shell-seat-root-status',
    plan   : 'shell-seat-root-plan',
    consent: 'shell-seat-root-consent'
});

/**
 * @summary Binds the broker to this installation's registry and the Brain's own path resolver.
 * An empty child override suppresses an inherited agents-root value and dotenv replacement;
 * the Brain's empty-string decoder then keeps its declared default. The parent env is untouched.
 * @param {Object} options
 * @param {String} options.repoRoot The packaged Brain root
 * @param {String} options.userData The installation's state directory
 * @param {String} [options.execPath=process.execPath] Bundled Electron executable
 * @param {Function} [options.resolvePaths=resolveBrainPaths] Resolver injection for isolated tests
 * @param {Function} [options.runScript=runBrainScript] Script invocation for isolated tests
 * @returns {Object} Destination resolver and installation-bound runStep for createSeatRootBroker
 */
export function createSeatRootRuntime({repoRoot, userData, execPath = process.execPath, resolvePaths = resolveBrainPaths, runScript = runBrainScript}) {
    const env = {
        ...buildPackagedBrainEnv({backupRoot: path.join(userData, 'backups'), dataRoot: path.join(userData, 'brain')}),
        ELECTRON_RUN_AS_NODE: '1',
        NEO_HARNESS_ELECTRON_BIN: execPath,
        NEO_FLEET_AGENTS_ROOT: ''
    };

    return {
        async resolveDestination() {
            const {fleetAgentsRoot} = await resolvePaths({env, repoRoot});
            if (typeof fleetAgentsRoot !== 'string' || !path.isAbsolute(fleetAgentsRoot)) {
                throw new Error('the Brain did not resolve an absolute seat root')
            }
            return fleetAgentsRoot
        },
        runStep: step => runSeatMoveStep({...step, runScript: ({env: stepEnv, ...script}) =>
            runScript({...script, env: {...env, ...stepEnv}, repoRoot})})
    }
}

/**
 * @summary Creates the installation's three seat-root handlers. Consent operations are serialized
 * across windows; a second request sees the first persisted transition before it can write.
 * @param {Object} options
 * @param {String} options.dir Installation userData directory
 * @param {Boolean} options.packaged Whether host operations are available
 * @param {Function} options.isTrustedSender Sender-frame validation
 * @param {Function} options.getOutcome This boot's settlement outcome, including a held boot
 * @param {Function|null} options.resolveDestination Brain-owned default root resolver
 * @param {Function} options.runStep The transition's installation-bound Brain invocation
 * @param {Function} options.relaunch Schedules shell relaunch after an accepted consent
 * @returns {Object} Handlers keyed by SEAT_ROOT_CHANNELS
 */
export function createSeatRootBroker({dir, packaged, isTrustedSender, getOutcome, resolveDestination, runStep, relaunch}) {
    const refuse = (code, reason = code) => ({state: 'refused', code, reason});
    let chain = Promise.resolve();

    /**
     * @summary Checks sender authority before any record read or host effect.
     * @param {Object} event
     * @returns {Object|null} Named unavailable result, or null when admitted
     */
    function admit(event) {
        if (!isTrustedSender(event)) throw new Error('seat-root: untrusted sender');
        return !packaged ? refuse('not-packaged') : null
    }

    return {
        /**
         * @summary Reads persisted inputs and boot outcome; malformed records stay unknown while
         * the held-boot reason remains visible. No failed read claims an absent record.
         * @param {Object} event
         * @returns {Promise<Object>}
         */
        async status(event) {
            const denied = admit(event);
            if (denied) return {packaged: false, root: null, pending: null, outcome: null};

            const read = operation => {
                try { return operation() } catch (error) { return {unreadable: error.message} }
            };
            const root = read(() => readSeatRootRecord({dir}));
            const pending = read(() => {
                const inputs = readSeatRootMove({dir});
                return inputs ? {
                    from: inputs.from, to: inputs.to, archive: inputs.archive,
                    rows: inputs.rows, outOfScope: inputs.outOfScope, consentedAt: inputs.consentedAt
                } : null
            });
            return {packaged: true, root, pending, outcome: getOutcome()}
        },

        /**
         * @summary Plans from the recorded root to the Brain's resolved destination. A pending
         * transition must settle before another can be consented.
         * @param {Object} event
         * @returns {Promise<Object>}
         */
        async plan(event) {
            const denied = admit(event);
            if (denied) return denied;
            if (!resolveDestination) return refuse('no-brain-root');

            const record = readSeatRootRecord({dir});
            if (!record) return refuse('no-seat-root', 'this installation records no seat root yet');
            const to = await resolveDestination();
            if (path.resolve(record.root) === path.resolve(to)) return refuse('nothing-to-move', 'the seats already use this root');
            return {...await planSeatMove({from: record.root, to, runStep}), from: record.root, to}
        },

        /**
         * @summary Consents only to the reviewed fingerprint. A fresh helper plan decides whether
         * inputs may be persisted; only its consented result schedules the relaunch.
         * @param {Object} event
         * @param {Object} request
         * @returns {Promise<Object>}
         */
        async consent(event, request) {
            const denied = admit(event);
            if (denied) return denied;
            if (!resolveDestination) return refuse('no-brain-root');
            if (!request || Object.keys(request).length !== 1 || typeof request.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(request.fingerprint)) {
                throw new TypeError('seat-root consent requires only the reviewed fingerprint')
            }

            const operation = async () => {
                const result = await consentSeatMove({dir, to: await resolveDestination(), fingerprint: request.fingerprint, runStep});
                if (result.state !== 'consented') return result;
                relaunch();
                return {state: 'consented'}
            };
            const next = chain.then(operation, operation);
            chain = next.catch(() => {});
            return next
        }
    }
}
