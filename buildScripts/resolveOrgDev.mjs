import {execFileSync}  from 'node:child_process';
import fs              from 'node:fs';
import path            from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * @summary Installs the Institution's two org dependencies, the Brain and the Engine, at their latest `dev` and
 * names the revisions that were installed.
 *
 * `package.json` names both at `dev`, but `npm ci` installs exactly the revision the lock last recorded. This step
 * reinstalls both from `dev` without touching `package.json` or the lock (`--no-save`), then reads the revisions
 * back from npm's own record of what is installed, `node_modules/.package-lock.json`. CI runs it after `npm ci`, so
 * every job runs the newest `dev`: a `dev` that breaks the Institution turns the job red with its revision named.
 * With `GITHUB_STEP_SUMMARY` set, the revisions also land in the job summary. Run it locally the same way:
 * `npm run resolve-org-dev`.
 * @module buildScripts/resolveOrgDev
 */

/**
 * The org dependencies the Institution tracks, each with the spec it resolves.
 * @type {Readonly<Object<String, String>>}
 */
export const ORG_DEPENDENCIES = Object.freeze({
    'neo-agent-brain': 'github:neomjs/neo-agent-brain#dev',
    'neo.mjs'        : 'github:neomjs/neo#dev'
});

/**
 * @summary The revision npm installed for one dependency: the commit after `#` in its resolved git URL.
 * @param {Object} installedLock The parsed `node_modules/.package-lock.json`
 * @param {String} name          The package name
 * @returns {String|null} `null` when the package is absent or not installed from git
 */
export function installedRevision(installedLock, name) {
    const resolved = installedLock?.packages?.[`node_modules/${name}`]?.resolved;

    return typeof resolved === 'string' && resolved.includes('#') ? resolved.slice(resolved.lastIndexOf('#') + 1) : null
}

/**
 * @summary Reads npm's record of what is installed under a project root.
 * @param {String} root The project root holding `node_modules`
 * @returns {Object|null} `null` when nothing has been installed yet
 */
export function readInstalledLock(root) {
    try {
        return JSON.parse(fs.readFileSync(path.join(root, 'node_modules', '.package-lock.json'), 'utf8'))
    } catch {
        return null
    }
}

// Import-safe: the helpers above serve `checkVisualBaselines.mjs`; the install runs only as the entry script
const root          = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
      isEntryScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntryScript) {
    execFileSync('npm', ['install', '--no-save', '--no-audit', '--no-fund',
        ...Object.entries(ORG_DEPENDENCIES).map(([name, spec]) => `${name}@${spec}`)], {cwd: root, stdio: 'inherit'});

    const installedLock = readInstalledLock(root),
          rows          = Object.keys(ORG_DEPENDENCIES).map(name => [name, installedRevision(installedLock, name)]);

    rows.forEach(([name, revision]) => console.log(`resolve-org-dev: ${name} dev → ${revision ?? 'unreadable'}`));

    if (process.env.GITHUB_STEP_SUMMARY) {
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
            `### Org dependencies at dev\n\n${rows.map(([name, revision]) => `- \`${name}\` → \`${revision ?? 'unreadable'}\``).join('\n')}\n`)
    }

    // A revision nobody can name is not a tracked dependency: fail closed
    rows.some(([, revision]) => !revision) && process.exit(1)
}
