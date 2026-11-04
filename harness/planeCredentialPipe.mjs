import readline from 'node:readline';

/**
 * @module harness/planeCredentialPipe
 * @summary Main's end of the fleet child's credential pipe. The stored plane bearer reaches the fleet child
 * on an inherited fd instead of its environment, so a PAT update reaches the running child with no relaunch.
 *
 * The protocol is the Brain's (`ai/services/fleet/planeCredentialChannel.mjs`); the shell imports no Brain
 * code, so it keeps its own copy. Each frame is one JSON line, `{"bearer": "…", "bearerClass": "github-pat"}`.
 * The first frame is the boot bearer, each later one a rotation. The child answers every frame once, in
 * order: `{"state": "adopted", "identity": "@x"}`, or `{"state": "refused", "reason": "…"}`, which adds
 * `resolvedIdentity` and `expectedIdentity` when the bearer belongs to another account. Main answers a frame
 * it can no longer deliver itself, as `{"state": "closed", "reason": "…"}`: the pipe closed or failed, and the
 * child keeps the bearer it holds. A frame is never logged, and an answer never carries one.
 */

/**
 * The fd the pipe takes in the fleet child: the first `stdio` entry after stdin, stdout and stderr.
 * @type {Number}
 */
export const PLANE_CREDENTIAL_FD = 3;

const CLOSED = 'the fleet child closed its credential pipe';

/**
 * @summary The frame for a stored record (`readPlaneConfig`): its bearer, and the class the plane named for it.
 * @param {{bearer: String, authSource: (String|null)}} record
 * @returns {{bearer: String, bearerClass: String}}
 */
export function planeCredentialFrame({bearer, authSource = null}) {
    return {bearer, bearerClass: authSource ?? ''}
}

/**
 * @summary Reads one answer line. A line that is neither answer counts as a refusal, so the shell never
 * adopts on an answer it could not read.
 * @param {String} line
 * @returns {{state: 'adopted', identity: String}|{state: 'refused', reason: String, resolvedIdentity?: String, expectedIdentity?: String}}
 */
export function parsePlaneCredentialAnswer(line) {
    let answer;

    try {
        answer = JSON.parse(line)
    } catch {
        answer = null
    }

    if (answer?.state === 'adopted' && typeof answer.identity === 'string') {
        return {identity: answer.identity, state: 'adopted'}
    }

    if (answer?.state !== 'refused') {
        return {reason: 'the fleet child answered the credential pipe with no readable answer', state: 'refused'}
    }

    const otherAccount = typeof answer.resolvedIdentity === 'string' && typeof answer.expectedIdentity === 'string';

    return {
        reason: typeof answer.reason === 'string' ? answer.reason : 'refused',
        state : 'refused',
        ...(otherAccount && {expectedIdentity: answer.expectedIdentity, resolvedIdentity: answer.resolvedIdentity})
    }
}

/**
 * @summary Opens main's end over the child's pipe (`child.stdio[PLANE_CREDENTIAL_FD]`). Answers are matched to
 * frames in the order they were sent. Once the pipe closes or fails, every frame still waiting, and every
 * later one, is answered as `closed`, so a caller never waits on a pipe that is gone.
 * @param {Object} options
 * @param {import('node:stream').Duplex} options.stream
 * @returns {{close: Function, isOpen: Function, send: Function}}
 */
export function openPlaneCredentialPipe({stream}) {
    const
        pending = [],
        lines   = readline.createInterface({crlfDelay: Infinity, input: stream});

    let open = true;

    const
        end  = reason => {
            if (!open) return;

            open = false;
            lines.close();
            pending.splice(0).forEach(resolve => resolve({reason, state: 'closed'}))
        },
        fail = () => end('the fleet child\'s credential pipe failed');

    lines.on('line', line => pending.shift()?.(parsePlaneCredentialAnswer(line)));
    lines.on('close', () => end(CLOSED));
    // readline forwards an input error to the interface, and the stream can still fail once readline let go of it
    lines.on('error', fail);
    stream.on('error', fail);

    return {
        /**
         * @summary Ends rotations. The child keeps the bearer it holds.
         */
        close() {
            end(CLOSED);
            stream.end()
        },

        /**
         * @returns {Boolean} Whether a frame sent now can still be answered.
         */
        isOpen() {
            return open
        },

        /**
         * @summary Sends one frame and resolves with the child's answer to it.
         * @param {{bearer: String, bearerClass: String}} frame
         * @returns {Promise<Object>} An answer as {@link parsePlaneCredentialAnswer} reads it, or `closed`.
         */
        send(frame) {
            if (!open) {
                return Promise.resolve({reason: CLOSED, state: 'closed'})
            }

            return new Promise(resolve => {
                pending.push(resolve);
                stream.write(`${JSON.stringify(frame)}\n`)
            })
        }
    }
}

/**
 * @summary Opens the pipe on a fleet child that `startBrainChild({credentialPipe: true})` spawned, and sends
 * the record's bearer as the boot frame.
 * @param {Object} options
 * @param {import('node:child_process').ChildProcess} options.child
 * @param {{bearer: String, authSource: (String|null)}} options.record The stored record the launch came from.
 * @returns {{boot: Promise<Object>, pipe: Object}} `boot` resolves with the child's answer to the boot frame.
 */
export function pipePlaneCredential({child, record}) {
    const pipe = openPlaneCredentialPipe({stream: child.stdio[PLANE_CREDENTIAL_FD]});

    return {boot: pipe.send(planeCredentialFrame(record)), pipe}
}

/**
 * @summary Hands a rotation frame to the fleet child serving `planeBase`. It resolves `null` only when no fleet
 * child runs for the plane this shell launched, so the caller may store the PAT and boot or relaunch. A running
 * child whose pipe closed keeps serving the bearer it bound, so its frame is answered `closed` instead.
 * @param {Object} options
 * @param {import('node:child_process').ChildProcess|null} options.child The registered fleet child, which
 *     carries its pipe as `planeCredentialPipe`.
 * @param {{bearer: String, bearerClass: String}} options.frame
 * @param {{planeBase: String}|null} options.launchedPlane The record this shell launched with (`launchedPlaneRecord`).
 * @param {String} options.planeBase
 * @returns {Promise<Object|null>}
 */
export async function rotatePlaneCredential({child, frame, launchedPlane, planeBase}) {
    const running = child && child.exitCode === null && !child.signalCode;

    return running && launchedPlane?.planeBase === planeBase ? child.planeCredentialPipe.send(frame) : null
}
