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
 * The installed-engine invariant, one step earlier in the same chain. The Engine tracks `dev`, so the
 * engine a capture renders with is whatever npm last installed, recorded in `node_modules/.package-lock.json`.
 * It must be nameable: the stamp records it beside the goldens, and a red capture run is traced through it.
 *
 * The old failure this guards is a theme build compiled from a different engine's SCSS than the one on
 * disk: the run passed its CSS-vs-SCSS check, and a capture committed the wrong engine's pixels as goldens
 * (two Observatory arms read as a `dev` regression for an hour). An engine install rewrites its SCSS with
 * fresh mtimes, so the CSS-vs-SCSS check below covers the engine's SCSS too: a new engine on disk with an
 * old theme build fails the run before any browser opens.
 */
const ENGINE_GUIDANCE = '  npm run resolve-org-dev';

/**
 * Reads the commit npm installed `neo.mjs` from — the `#<sha>` suffix of the package's `resolved` field in
 * npm's own record of the install.
 * @returns {String|null} The commit, or `null` when nothing has been installed from git
 */
function installedEngineCommit() {
    const file = path.join(repoRoot, 'node_modules/.package-lock.json');

    if (!fs.existsSync(file)) {
        return null
    }

    const resolved = JSON.parse(fs.readFileSync(file, 'utf8')).packages?.['node_modules/neo.mjs']?.resolved;

    return resolved?.match(/#([0-9a-f]{40})$/)?.[1] ?? null
}

export default function globalSetup() {
    const installedEngine = installedEngineCommit();

    if (!installedEngine) {
        throw new Error(
            'visual harness: no installed engine revision is recorded in node_modules/.package-lock.json — a ' +
            'baseline over an engine nobody can name cannot be traced:\n' + ENGINE_GUIDANCE
        )
    }

    console.log(`visual harness: rendering with engine ${installedEngine}`);

    const newestScss = Math.max(
              newestMtime(path.join(repoRoot, 'resources/scss'), '.scss'),
              newestMtime(path.join(repoRoot, 'node_modules/neo.mjs/resources/scss'), '.scss')
          ),
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
