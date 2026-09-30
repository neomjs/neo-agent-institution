import fs              from 'fs';
import path            from 'path';
import {fileURLToPath} from 'url';

import {
    DEVELOPMENT_THEME_BUILD_COMMAND,
    newestMtime
} from '../../../node_modules/neo.mjs/buildScripts/util/developmentThemeAssets.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../');

/**
 * The rebuild-before-baseline invariant, enforced mechanically: the dist theme CSS is a
 * gitignored BUILD artifact — merged SCSS is invisible to every rendered surface until the
 * theme build runs, so a golden captured over stale artifacts is a poisoned baseline that
 * silently locks in the WRONG pixels. A stale tree fails the whole visual run loudly;
 * capturing anyway is never an option.
 *
 * The guidance names the RECOVERY command first and the durable habit second, and both halves
 * are executable as printed — which is the part that needs saying, because a command in an error
 * message is an API: its interactivity, its process lifetime and its terminal ownership are part
 * of the contract, not incidental.
 *
 * So the recovery line is `DEVELOPMENT_THEME_BUILD_COMMAND`, imported from the same module this
 * file already reads mtimes from rather than retyped. Retyping it is how the earlier `npm run
 * build-themes` reached this file: that expands to `themes.mjs -f`, and without `-n` the script
 * falls into its Inquirer theme/environment prompts — an interactive question where the reader
 * expected a rebuild. The e2e preflight prints this same constant for the same reason.
 *
 * `watch-themes` is listed SEPARATELY and marked long-running, never chained with `&&`. It holds
 * a recursive `fs.watch` and is designed to stay up, so chaining would hand the author a blocked
 * terminal instead of returning them to the run they came here to fix.
 *
 * Deliberately NOT auto-rebuilding here — and not on cost grounds, since the build is ~1.3s.
 * The watcher already covers this and serves every surface, so a repair bolted into one
 * harness's setup would be a second mechanism for a solved problem, reachable only by the
 * authors who happen to run visual tests.
 */
const THEME_GUIDANCE =
    `  ${DEVELOPMENT_THEME_BUILD_COMMAND}\n` +
    '  then, in a SEPARATE shell, `npm run watch-themes` — it stays running and keeps the CSS\n' +
    '  fresh for the rest of the session, so this failure stops recurring';

/**
 * The installed-engine invariant, one step earlier in the same chain: `package-lock.json` pins
 * `neo.mjs` to a git commit, and `node_modules/.package-lock.json` records what npm actually put
 * on disk. A plain `npm install` leaves a github-SHA dependency where it is, so the two drift
 * apart silently — the theme build then compiles the wrong engine's SCSS, the CSS-vs-SCSS check
 * above passes, the stamp compares Institution inputs only, and a capture commits the wrong
 * engine's pixels as goldens. Two Observatory arms read as a `dev` regression for an hour before
 * the drift was found; the guard turns that into a setup error before any browser opens.
 *
 * The recovery is the realign, not `npm install` alone: npm treats the installed git package as
 * satisfied until its directory is gone.
 */
const ENGINE_GUIDANCE = '  rm -rf node_modules/neo.mjs && npm install';

/**
 * Reads the commit an npm lock file resolves `neo.mjs` to — the `#<sha>` suffix of the package's
 * `resolved` field — so the pinned and the installed engine can be compared by identity.
 * @param {String} lockFile A lock file path relative to the repository root
 * @returns {String|null} The 40-character commit, or `null` when the file or the entry is missing
 */
function resolvedEngineCommit(lockFile) {
    const file = path.join(repoRoot, lockFile);

    if (!fs.existsSync(file)) {
        return null
    }

    const resolved = JSON.parse(fs.readFileSync(file, 'utf8')).packages?.['node_modules/neo.mjs']?.resolved;

    return resolved?.match(/#([0-9a-f]{40})$/)?.[1] ?? null
}

export default function globalSetup() {
    const pinnedEngine    = resolvedEngineCommit('package-lock.json'),
          installedEngine = resolvedEngineCommit('node_modules/.package-lock.json');

    if (!pinnedEngine || !installedEngine || pinnedEngine !== installedEngine) {
        throw new Error(
            `visual harness: the installed engine (${installedEngine ?? 'none recorded'}) is not the locked one ` +
            `(${pinnedEngine ?? 'none pinned'}) — a baseline over the wrong engine is a poisoned golden:\n` +
            ENGINE_GUIDANCE
        )
    }

    const newestScss = newestMtime(path.join(repoRoot, 'resources/scss'), '.scss'),
          newestCss  = newestMtime(path.join(repoRoot, 'dist/development/css'), '.css');

    if (newestCss === 0) {
        throw new Error(
            'visual harness: no built theme CSS found under dist/development/css. This is the ' +
            'first-run state on a fresh clone or a newly checked-out branch — the artifacts are ' +
            'gitignored, so switching branches never brings them along:\n' + THEME_GUIDANCE
        )
    }

    if (newestScss > newestCss) {
        throw new Error(
            'visual harness: the built theme CSS is OLDER than the newest SCSS source — a baseline over ' +
            'stale artifacts is a poisoned golden:\n' + THEME_GUIDANCE
        )
    }
}
