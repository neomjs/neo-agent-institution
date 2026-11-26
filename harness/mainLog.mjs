import fs   from 'node:fs';
import path from 'node:path';

/**
 * @module harness/mainLog
 * @summary The shell's own log. Every line main prints also lands in `main.log` under the platform's
 * logs folder (`~/Library/Logs/neo-harness` on macOS). A Finder launch has no terminal, so without
 * this its boot lines (`HARNESS_BRAIN_PLAN`, `HARNESS_BRAIN_MODE`, the Brain children's lines) are
 * gone, and a failed boot cannot be read.
 *
 * The file boundary holds the one redaction rule: a line carrying any secret main currently holds is
 * written as a marker instead. The file rotates once past its cap, and a log that cannot write stops
 * quietly rather than failing the boot it exists to explain.
 */

/**
 * @type {String}
 */
export const MAIN_LOG_FILE = 'main.log';

/**
 * @type {String}
 */
export const BOOT_TIMING_PREFIX = 'HARNESS_BOOT_TIMING';

/**
 * @type {String}
 */
export const REDACTED_LINE = '[secret-bearing line redacted]';

/**
 * @summary Whether a line carries any of the given secrets. Empty or non-string entries never match,
 * so a secret main does not hold (`null`) redacts nothing.
 * @param {String} line
 * @param {Array<String|null>} secrets
 * @returns {Boolean}
 */
export function carriesSecret(line, secrets) {
    return secrets.some(secret => typeof secret === 'string' && secret.length > 0 && line.includes(secret))
}

/**
 * @summary Renders console arguments the way a terminal would read them: strings as they are, errors
 * with their stack, anything else as JSON where it serializes.
 * @param {Array} args
 * @returns {String}
 */
function renderArgs(args) {
    return args.map(arg => {
        if (typeof arg === 'string') return arg;
        if (arg instanceof Error)    return arg.stack || String(arg);

        try {
            return JSON.stringify(arg) ?? String(arg)
        } catch {
            return String(arg)
        }
    }).join(' ')
}

/**
 * @summary Creates the log. Nothing touches the disk until the first line.
 * @param {Object} options
 * @param {String} options.dir The logs folder (`app.getPath('logs')`).
 * @param {Function} [options.secrets] `() => Array<String|null>`, the secrets main holds at call time.
 * @param {Number} [options.maxBytes=1048576] Past this size the file rotates once to `main.log.1`.
 * @param {Function} [options.now] `() => Date`, injectable for tests.
 * @param {Object} [options.fsModule=fs]
 * @returns {{file: String, install: Function, write: Function}}
 */
export function createMainLog({dir, secrets = () => [], maxBytes = 1024 * 1024, now = () => new Date(), fsModule = fs}) {
    const file = path.join(dir, MAIN_LOG_FILE);

    let disabled = false,
        size     = null;

    /**
     * @summary Appends one line, timestamped, redacted if it carries a secret.
     * @param {...*} args
     */
    function write(...args) {
        if (disabled) {
            return
        }

        try {
            const
                text  = renderArgs(args),
                entry = `${now().toISOString()} ${carriesSecret(text, secrets()) ? REDACTED_LINE : text}\n`,
                bytes = Buffer.byteLength(entry);

            if (size === null) {
                fsModule.mkdirSync(dir, {recursive: true});
                size = fsModule.existsSync(file) ? fsModule.statSync(file).size : 0
            }

            if (size > 0 && size + bytes > maxBytes) {
                fsModule.renameSync(file, `${file}.1`);
                size = 0
            }

            fsModule.appendFileSync(file, entry, {mode: 0o600});
            size += bytes
        } catch {
            disabled = true
        }
    }

    /**
     * @summary Tees the target's `log`, `warn` and `error` into the file; the originals still print.
     * A terminal whose reader went away (EPIPE) fails every print; unheard, each failure is an uncaught
     * exception, which Electron shows as a modal dialog. The terminal half drops quietly instead, and
     * the file names why once.
     * @param {Object} [target=console]
     * @param {EventEmitter[]} [terminal=[process.stdout, process.stderr]] The streams the originals print to.
     */
    function install(target = console, terminal = [process.stdout, process.stderr]) {
        let terminalClosed = false;

        for (const stream of terminal) {
            stream.on('error', error => {
                terminalClosed || write(`HARNESS_TERMINAL_CLOSED ${error.code ?? error.message}`);
                terminalClosed = true
            })
        }

        for (const level of ['log', 'warn', 'error']) {
            const original = target[level].bind(target);

            target[level] = (...args) => {
                original(...args);
                write(...args)
            }
        }
    }

    return {file, install, write}
}

/**
 * @summary Records boot-step timings from process start into the shell log so a slow launch names the
 * exact phase that took the time. `step` records sequential milestones (`deltaMs` since the prior step
 * plus `uptimeMs` since process launch); `span` measures an asynchronous or parallel phase's own
 * `durationMs` without perturbing sequential `step` deltas.
 * @param {Object} [options]
 * @param {Function} [options.log] Line sink; defaults to `console.log` so installed `main.log` captures and redacts it.
 * @param {Function} [options.uptimeMs] Monotonic ms since process start; injectable for tests.
 * @returns {{span: Function, step: Function}}
 */
export function createBootTimer({
    log = line => console.log(line),
    uptimeMs = () => Math.round(process.uptime() * 1000)
} = {}) {
    let lastMs = 0;

    function emit(payload) {
        log(`${BOOT_TIMING_PREFIX} ${JSON.stringify(payload)}`);
        return payload
    }

    return {
        span(step, initial = {}) {
            const startedMs = Math.max(0, Math.round(uptimeMs()));

            return (extra = {}) => {
                const currentMs = Math.max(startedMs, Math.round(uptimeMs()));

                return emit({
                    step,
                    durationMs: currentMs - startedMs,
                    uptimeMs  : currentMs,
                    ...initial,
                    ...extra
                })
            }
        },
        step(step, extra = {}) {
            const
                currentMs = Math.max(lastMs, Math.round(uptimeMs())),
                deltaMs   = currentMs - lastMs;

            lastMs = currentMs;
            return emit({
                step,
                deltaMs,
                uptimeMs: currentMs,
                ...extra
            })
        }
    }
}
