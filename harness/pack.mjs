// The E6 pack stage: materializes the ORGANISM the packaged shell ships — the renderer's source
// graph (derived from the contentPolicy allowlist, one authority) from the product root, the Brain
// tree from the explicit Brain root, a generated dependency manifest (each staged tree's bare
// imports, pinned by the owner that stages it — the product's package.json for the renderer graph,
// the Brain root's for `ai/`), a pack-time-fresh instance config (killing the first-boot write into
// a possibly read-only resources dir), and a `node` shim so shebang children (the chroma CLI) run
// on the bundled Electron runtime via ELECTRON_RUN_AS_NODE — a stranger's machine carries no Node.
//
// Shell-ADR bindings implemented here (§2.5 — the E6 row):
//   §2.5.1  one double-clickable artifact wrapping the organism; the packaging root owns it
//   §2.5.2  the UNSIGNED leg only — signing material never enters repo tooling
//   §2.6    the bundled app layer is the SOURCE graph the allowlist names (NL possession), never
//           a minified bundle
//
// Native-module runtime decision (the arm this leaf owns, recorded on its ticket): Brain children
// run under ELECTRON_RUN_AS_NODE, and the staged node_modules is REBUILT for the bundled
// Electron's ABI via @electron/rebuild — scoped to the stage, never the checkout (rebuilding the
// shared dev node_modules is the recorded kill-the-dev-loop trap). A rebuild failure FAILS THE
// BUILD: ABI-compat of a system-Node build under electron-as-node is not a guaranteed contract
// (independent probes disagreed), and a silently mis-built native module is a broken artifact.

import {execFileSync}                               from 'node:child_process';
import fs                                           from 'node:fs';
import {builtinModules}                             from 'node:module';
import path                                         from 'node:path';
import {fileURLToPath}                              from 'node:url';
import {parse}                                      from 'acorn';
import {resolveAgentOsRuntimeRoot}                  from './brain.mjs';
import {ALLOWED_EXACT_PATHS, ALLOWED_PATH_PREFIXES} from './contentPolicy.mjs';

const
    harnessDir = path.dirname(fileURLToPath(import.meta.url)),
    repoRoot   = path.resolve(harnessDir, '..');

export const STAGE_DIR = path.join(harnessDir, '.stage', 'organism');

// Runtime trees the renderer allowlist cannot know about: the Brain's `ai/` and its own `src/`
// (composition, evolution — `ai/` imports it relatively). Both resolve against the BRAIN root, never
// this checkout; the Engine modules the Brain imports bare (`neo.mjs/src/…`, its sanitizer among
// them) come from the staged dependency install, like every node_modules-prefixed allowlist entry.
// The Brain's `src/` lands beside the product's `src/` in the stage: distinct subtrees today, and a
// same-path collision between the two owners fails the copy loud.
export const BRAIN_TREES = Object.freeze([
    'ai',
    'src'
]);

// Coordinates inside staged trees that are NOT runtime surface. Entries may name a subtree or one
// exact file: demo/example apps carry demo deps; the temporal-summary daemon is not runtime-enabled
// (its aggregation script imports it and goes with it — a staged importer of an excluded tree is a
// dangling import); and the Genesis probe is a checkout-only operator command whose browser runtime
// is supplied by the checkout rather than the double-clickable organism. Runtime diagnostics stay
// staged.
export const TREE_EXCLUDES = Object.freeze([
    'ai/examples',
    'ai/daemons/temporal-summary',
    'ai/scripts/maintenance/aggregate-temporal-summary.mjs',
    'ai/scripts/diagnostics/genesisProbe.mjs'
]);

// The theme builder the stage runs before copying `dist/development/css`: an ENGINE-package script
// (the product's own `build-themes` is the same path), resolved inside the pinned install — the
// product root carries no buildScripts/build of its own since the split.
export const ENGINE_THEME_BUILD = 'buildScripts/build/themes.mjs';

/**
 * @summary True when a repo-relative path is a checkout-instance CONFIG OVERLAY — a `config.mjs`
 * with a `config.template.mjs` sibling. The template marks the overlay slot, so the rule is
 * DERIVED, never an enumerated list: every gitignored operator overlay (the top-level
 * `ai/config.mjs` AND each per-server `ai/mcp/server/<name>/config.mjs`) can carry hand-edited
 * credentials and must never ship; the stage regenerates fresh template-defaults instances. A tracked
 * standalone `config.mjs` (no template sibling) is ordinary source and ships normally.
 * @param {String} sourceRoot Absolute root the relative path resolves against.
 * @param {String} relativePath Repo-relative candidate path.
 * @returns {Boolean}
 */
export function isInstanceOverlayPath(sourceRoot, relativePath) {
    return path.basename(relativePath) === 'config.mjs' &&
        fs.existsSync(path.join(sourceRoot, path.dirname(relativePath), 'config.template.mjs'))
}

/**
 * @summary Belt-and-braces post-copy assertion: the staged tree must contain ZERO instance
 * overlays before the fresh-config generation runs. A filter regression here is a
 * credential-shipping vector, so it fails the build loudly rather than trusting one predicate.
 * @param {String} stageDir
 */
export function assertNoInstanceOverlays(stageDir) {
    const offenders = [];

    const walk = dir => {
        for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                walk(fullPath)
            } else if (isInstanceOverlayPath(stageDir, path.relative(stageDir, fullPath))) {
                offenders.push(path.relative(stageDir, fullPath))
            }
        }
    };

    walk(stageDir);

    if (offenders.length > 0) {
        throw new Error(`pack: checkout instance overlay(s) reached the stage — refusing to ship: ${offenders.join(', ')}`)
    }
}

// Dependencies the bare-import scan cannot see, each under the OWNER whose manifest declares it:
// the product's CSS-linked fonts and URL-imported public Fleet contract, plus the Chroma embed
// provider the Brain resolves dynamically at runtime. Renderer paths never widen runtime policy.
export const SUPPLEMENTAL_DEPENDENCIES = Object.freeze({
    brain  : Object.freeze(['@chroma-core/default-embed']),
    product: Object.freeze(['@fortawesome/fontawesome-free', 'neo-agent-brain'])
});

// Shared names with ONE declared owner, whichever tree imports them: the Engine is the product's
// pin — the Brain checkout's own `neo.mjs` declaration never reaches the organism. Every other
// name both owners declare must agree, or the pack fails loud (no silent precedence).
export const OWNER_EXCEPTIONS = Object.freeze({
    'neo.mjs': 'product'
});

// Lazily-imported packages on modes the packaged product never enters (the MCP shared transport's
// HTTP/cloud leg) — ALSO phantom deps the repo never declares (they resolve transitively on dev
// machines; recorded finding). Excluded unless the repo declares them; a future mode enablement
// fails loudly at its own import site, never as a silent ship.
export const OPTIONAL_LAZY_PACKAGES = Object.freeze([
    'ajv',
    'cors'
]);

/**
 * @summary Derives the copy specs per OWNER: the renderer's source graph from the allowlist (URL-path
 * form, product-root-relative) and the Brain set (Brain-root-relative). One authority each: a new
 * allowlist prefix ships automatically; the Brain set is `BRAIN_TREES`.
 * @returns {{brain: {trees: String[]}, product: {files: String[], trees: String[]}}}
 */
export function deriveCopySpecs() {
    const
        trees = new Set(),
        files = new Set();

    for (const prefix of ALLOWED_PATH_PREFIXES) {
        if (!prefix.startsWith('/node_modules/')) {
            trees.add(prefix.replace(/^\/|\/$/g, ''))
        }
    }

    for (const exact of ALLOWED_EXACT_PATHS) {
        if (!exact.startsWith('/node_modules/')) {
            files.add(exact.replace(/^\//, ''))
        }
    }

    return {
        brain  : {trees: [...BRAIN_TREES]},
        product: {files: [...files].sort(), trees: [...trees].sort()}
    }
}

/**
 * @summary Resolves the three owners the stage assembles from, and proves each BEFORE anything is
 * mutated: the PRODUCT root (this checkout — the renderer graph and its `package.json`), the ENGINE
 * package (the pinned `neo.mjs` install inside it), and the BRAIN root (`NEO_AGENTOS_RUNTIME_ROOT`,
 * absolute by the one runtime-root contract in brain.mjs — never a cwd or sibling guess). A missing
 * or relative Brain authority, or a root without its markers, throws here: no stage dir removed, no
 * theme built, nothing installed.
 * @param {Object} [options]
 * @param {Object} [options.env=process.env]
 * @param {String} [options.productRoot] Defaults to this checkout.
 * @returns {{brainRoot: String, enginePackageRoot: String, productRoot: String}}
 */
export function resolvePackRoots({env = process.env, productRoot = repoRoot} = {}) {
    const
        resolvedProduct   = path.resolve(productRoot),
        enginePackageRoot = path.join(resolvedProduct, 'node_modules', 'neo.mjs'),
        brainRoot         = resolveAgentOsRuntimeRoot(env),
        owners            = [
            ['product',        resolvedProduct,   ['apps/agentos', 'package.json']],
            ['engine package', enginePackageRoot, ['package.json', ENGINE_THEME_BUILD]],
            ['brain',          brainRoot,         ['package.json', ...BRAIN_TREES]]
        ];

    for (const [owner, root, markers] of owners) {
        for (const marker of markers) {
            if (!fs.existsSync(path.join(root, marker))) {
                throw new Error(`pack: the ${owner} root ${root} carries no ${marker} — refusing to stage`)
            }
        }
    }

    return {brainRoot, enginePackageRoot, productRoot: resolvedProduct}
}

function readPackageJson(root) {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
}

// npm package-name shape — rejects non-package specifiers before manifest projection.
const PACKAGE_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

/**
 * @summary Extracts unique string-literal module specifiers from JavaScript syntax: static imports,
 * side-effect imports, re-exports, and dynamic `import()` expressions. Ordinary strings, template
 * text, comments, and non-literal dynamic expressions remain inert. Module syntax is attempted
 * first; a script fallback covers staged CommonJS sources. Unparseable source fails the pack loudly.
 * @param {String} source
 * @returns {String[]}
 */
export function extractLiteralImportSpecifiers(source) {
    const
        options = {allowHashBang: true, ecmaVersion: 'latest'},
        text    = String(source);

    let ast;

    try {
        ast = parse(text, {...options, sourceType: 'module'})
    } catch (moduleError) {
        try {
            ast = parse(text, {...options, allowReturnOutsideFunction: true, sourceType: 'script'})
        } catch (scriptError) {
            throw new SyntaxError(`pack import scan could not parse source as module (${moduleError.message}) or script (${scriptError.message})`)
        }
    }

    const specifiers = new Set();

    const visit = node => {
        if (!node || typeof node !== 'object') return;

        if ((node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') &&
            node.source?.type === 'Literal' && typeof node.source.value === 'string') {
            specifiers.add(node.source.value)
        } else if (node.type === 'ImportExpression' && node.source?.type === 'Literal' && typeof node.source.value === 'string') {
            specifiers.add(node.source.value)
        }

        for (const value of Object.values(node)) {
            if (Array.isArray(value)) {
                value.forEach(visit)
            } else if (value?.type) {
                visit(value)
            }
        }
    };

    visit(ast);

    return [...specifiers].sort()
}

/**
 * @summary Extracts direct or descendant `./` `.mjs` dependencies for the harness app.asar file
 * closure. Parent-root imports remain forbidden by the separate packaged-main contract.
 * @param {String} source
 * @returns {String[]}
 */
export function extractLocalMjsImports(source) {
    return extractLiteralImportSpecifiers(source)
        .filter(specifier => specifier.startsWith('./') && specifier.endsWith('.mjs'))
        .map(specifier => specifier.slice(2))
}

/**
 * @summary Extracts the BARE (package) import specifiers from one module source: static imports,
 * side-effect imports, re-exports, and string-literal dynamic imports. Relative (`./`), absolute,
 * subpath-alias (`#`), and node built-in specifiers are
 * excluded; non-npm-shaped candidates are dropped; subpath imports reduce to their package name
 * (`chromadb/x` → `chromadb`, `@scope/pkg/x` → `@scope/pkg`).
 * @param {String} source
 * @returns {String[]} unique package names.
 */
export function extractBarePackages(source) {
    const
        builtins = new Set(builtinModules),
        packages = new Set();

    for (const specifier of extractLiteralImportSpecifiers(source)) {
        if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('#') || specifier.startsWith('node:')) {
            continue
        }

        const
            segments    = specifier.split('/'),
            packageName = specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];

        if (!builtins.has(packageName) && PACKAGE_NAME_RE.test(packageName)) {
            packages.add(packageName)
        }
    }

    return [...packages].sort()
}

/**
 * @summary Collects every bare package import of an explicit FILE SET — the files one owner copied,
 * never a directory walk: both owners land a `src/` in the stage, and walking the merged directory
 * would credit every import in it to both owners (a Brain-only import declared by the Brain alone
 * would then read as missing for the product, and the reverse). Non-script files are skipped.
 * @param {Object} options
 * @param {String[]} options.files Stage-relative paths.
 * @param {String} options.rootDir The stage.
 * @returns {String[]} unique package names across the set.
 */
export function collectBarePackages({files, rootDir}) {
    const packages = new Set();

    for (const file of files) {
        if (/\.(mjs|cjs|js)$/.test(file)) {
            extractBarePackages(fs.readFileSync(path.join(rootDir, file), 'utf8')).forEach(name => packages.add(name))
        }
    }

    return [...packages].sort()
}

/**
 * @summary Builds the organism's dependency manifest with the PROVENANCE of every import kept: a
 * package the product's trees import is pinned by the product `package.json`, one the Brain tree
 * imports by the Brain root's `package.json` (both tiers of each), and a name both trees import
 * must carry the SAME declaration in both owners — a disagreement fails the pack, never a silent
 * precedence. `ownerExceptions` names the shared packages one owner governs outright (`neo.mjs`:
 * the Engine is the product's pin). Both manifests are required: a scan that cannot see the Brain's
 * hard-errors exactly where a broken artifact would otherwise ship. An import its own owner never
 * declared is a hard error too — the checkout would have failed the same way.
 * @param {Object} options
 * @param {{brain: String[], product: String[]}} options.scanned Bare package names per staging owner.
 * @param {Object} options.productPackageJson Parsed product package.json.
 * @param {Object} options.brainPackageJson Parsed Brain-root package.json.
 * @param {{brain: String[], product: String[]}} [options.supplemental=SUPPLEMENTAL_DEPENDENCIES]
 * @param {String[]} [options.optionalLazy=OPTIONAL_LAZY_PACKAGES]
 * @param {Object} [options.ownerExceptions=OWNER_EXCEPTIONS]
 * @returns {Object} `{name, private, type, version, dependencies}` — the staged package.json.
 */
export function buildOrganismManifest({
    scanned,
    productPackageJson,
    brainPackageJson,
    supplemental = SUPPLEMENTAL_DEPENDENCIES,
    optionalLazy = OPTIONAL_LAZY_PACKAGES,
    ownerExceptions = OWNER_EXCEPTIONS
}) {
    if (!productPackageJson || !brainPackageJson) {
        throw new Error('organism manifest: the product package.json and the Brain package.json are both required dependency authorities')
    }

    const
        manifests     = {brain: brainPackageJson, product: productPackageJson},
        declaredBy    = owner => ({...manifests[owner].devDependencies, ...manifests[owner].dependencies}),
        wanted        = Object.fromEntries(Object.keys(manifests).map(owner => [owner, new Set([...(scanned?.[owner] ?? []), ...(supplemental[owner] ?? [])])])),
        names         = [...new Set(Object.values(wanted).flatMap(set => [...set]))].sort(),
        dependencies  = {},
        missing       = [],
        disagreements = [];

    for (const name of names) {
        const governing = ownerExceptions[name];

        if (governing) {
            const range = declaredBy(governing)[name];

            range ? (dependencies[name] = range) : missing.push(`${name} (${governing})`);
            continue
        }

        const ranges = Object.keys(wanted)
            .filter(owner => wanted[owner].has(name))
            .map(owner => [owner, declaredBy(owner)[name]]);

        ranges.filter(([, range]) => !range && !optionalLazy.includes(name))
            .forEach(([owner]) => missing.push(`${name} (${owner})`));

        const declared = ranges.filter(([, range]) => range);

        if (declared.length === 0) {
            continue
        }

        if (new Set(declared.map(([, range]) => range)).size > 1) {
            disagreements.push(`${name}: ${declared.map(([owner, range]) => `${owner} ${range}`).join(' vs ')}`);
            continue
        }

        dependencies[name] = declared[0][1]
    }

    if (missing.length > 0) {
        throw new Error(`organism manifest: no declared version for imported package(s): ${missing.join(', ')}`)
    }

    if (disagreements.length > 0) {
        throw new Error(`organism manifest: the owners disagree on ${disagreements.join('; ')} — align the declarations or name a governing owner in OWNER_EXCEPTIONS`)
    }

    return {
        dependencies,
        name   : 'neo-harness-organism',
        private: true,
        type   : 'module',
        version: productPackageJson.version ?? '0.0.0'
    }
}

/**
 * @summary The packaged-runtime import closure, checked once the stage is complete (after the
 * install AND the fresh config generation — the generated `config.mjs` files are import targets):
 * every package the manifest pins is PRESENT under the stage's own `node_modules` (its package.json
 * exists — package presence, not module resolution), and every RELATIVE import of a staged module
 * resolves to a file inside the stage. npm reports an optional or platform-skipped package as a
 * warning at most, and a tree copied without the sibling tree it imports looks complete on disk —
 * a stranger's double-click would find out at the first import instead.
 * @param {Object} options
 * @param {Object} options.manifest The staged package.json.
 * @param {String} options.stageDir
 * @param {String[]} [options.trees=[]] Stage-relative trees whose modules' relative imports are checked.
 */
export function assertImportClosure({manifest, stageDir, trees = []}) {
    const
        missing  = Object.keys(manifest.dependencies)
            .filter(name => !fs.existsSync(path.join(stageDir, 'node_modules', name, 'package.json'))),
        dangling = [];

    const walk = dir => {
        for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                if (entry.name !== 'node_modules' && entry.name !== '.git') {
                    walk(fullPath)
                }
            } else if (/\.(mjs|cjs|js)$/.test(entry.name)) {
                extractLiteralImportSpecifiers(fs.readFileSync(fullPath, 'utf8'))
                    .filter(specifier => specifier.startsWith('./') || specifier.startsWith('../'))
                    .filter(specifier => !fs.existsSync(path.resolve(dir, specifier)))
                    .forEach(specifier => dangling.push(`${path.relative(stageDir, fullPath)} → ${specifier}`))
            }
        }
    };

    // two owners may name the same stage path (both carry a `src/`): walk it once
    [...new Set(trees)].forEach(tree => walk(path.join(stageDir, tree)));

    if (missing.length > 0) {
        throw new Error(`pack: the staged install lacks pinned package(s): ${missing.join(', ')}`)
    }

    if (dangling.length > 0) {
        throw new Error(`pack: staged module(s) import outside the stage: ${dangling.join(', ')}`)
    }
}

/**
 * @summary Materializes every instance-overlay slot the copy filter left empty: a staged
 * `config.template.mjs` whose `config.mjs` sibling is absent gets the template as its pack-time-fresh
 * instance — the same DERIVED rule the exclusion uses, so a slot the Brain's own setup script does
 * not know (its `src/evolution/config.mjs`, for one) still ships template-current. A slot the setup
 * script already filled is left alone.
 * @param {Object} options
 * @param {String} options.stageDir
 * @param {String[]} options.trees Stage-relative trees to walk.
 * @returns {String[]} the stage-relative configs written.
 */
export function materializeOverlaySlots({stageDir, trees}) {
    const written = [];

    const walk = dir => {
        for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                if (entry.name !== 'node_modules' && entry.name !== '.git') {
                    walk(fullPath)
                }
            } else if (entry.name === 'config.template.mjs' && !fs.existsSync(path.join(dir, 'config.mjs'))) {
                fs.copyFileSync(fullPath, path.join(dir, 'config.mjs'));
                written.push(path.relative(stageDir, path.join(dir, 'config.mjs')))
            }
        }
    };

    [...new Set(trees)].forEach(tree => walk(path.join(stageDir, tree)));

    return written.sort()
}

/**
 * @summary The provenance the shipped artifact carries: role, package name, version, the Engine's
 * pin and the Brain's revision — and NO build-host coordinate. The stage's `organism-build-info.json`
 * rides `extraResources` verbatim, so an absolute checkout path written here would ship to every
 * stranger's machine.
 * @param {Object} options
 * @param {Object} options.brainPackageJson
 * @param {Object} options.enginePackageJson
 * @param {Object} options.productPackageJson
 * @param {{brainRoot: String}} options.roots Consulted for the Brain revision only; never recorded.
 * @param {Function} [options.revisionOf=readRevision] `(root) => String|null`, injectable for tests.
 * @returns {{brain: Object, engine: Object, product: Object}}
 */
export function describeOwners({brainPackageJson, enginePackageJson, productPackageJson, roots, revisionOf = readRevision}) {
    return {
        brain  : {name: brainPackageJson.name ?? null, revision: revisionOf(roots.brainRoot), version: brainPackageJson.version ?? null},
        engine : {name: enginePackageJson.name ?? 'neo.mjs', pin: productPackageJson.dependencies?.['neo.mjs'] ?? null, version: enginePackageJson.version ?? null},
        product: {name: productPackageJson.name ?? null, version: productPackageJson.version ?? null}
    }
}

function readRevision(root) {
    try {
        return execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim() || null
    } catch {
        return null
    }
}

/**
 * @summary The `node` PATH shim for shebang children (`#!/usr/bin/env node` — the chroma CLI): a
 * stranger's machine carries no Node, so the shim execs the packaged Electron binary in node mode.
 * The binary path arrives via env at spawn time (`NEO_HARNESS_ELECTRON_BIN`) because the install
 * location is unknowable at pack time.
 * @returns {String} POSIX shell shim source.
 */
export function buildNodeShim() {
    return [
        '#!/bin/sh',
        '# neo-harness organism shim: routes `node` shebangs onto the bundled Electron runtime.',
        ': "${NEO_HARNESS_ELECTRON_BIN:?NEO_HARNESS_ELECTRON_BIN is not set}"',
        'ELECTRON_RUN_AS_NODE=1 exec "$NEO_HARNESS_ELECTRON_BIN" "$@"',
        ''
    ].join('\n')
}

// Two owners may share a directory in the stage (both carry a `src/`), never a file: an existing
// target is a collision between owners and fails the copy instead of letting the later one win.
// Both copiers return the stage-relative files they placed — the owner's provenance for the scan.
function copyTree(sourceRoot, targetRoot, relative) {
    const
        source = path.join(sourceRoot, relative),
        copied = [];

    if (!fs.existsSync(source)) {
        throw new Error(`pack: staged tree missing in ${sourceRoot}: ${relative}`)
    }

    try {
        fs.cpSync(source, path.join(targetRoot, relative), {
            errorOnExist: true,
            filter      : entry => {
                const
                    rel   = path.relative(sourceRoot, entry),
                    ships = !TREE_EXCLUDES.some(exclude => rel === exclude || rel.startsWith(exclude + path.sep)) &&
                        !isInstanceOverlayPath(sourceRoot, rel) &&
                        !/(^|\/)(node_modules|\.git)(\/|$)/.test(rel) &&
                        !/(^|\/)\.env(\.|$)/.test(rel) &&
                        !rel.endsWith('.DS_Store');

                ships && fs.statSync(entry).isFile() && copied.push(rel);

                return ships
            },
            force    : false,
            recursive: true
        })
    } catch (error) {
        if (error?.code === 'ERR_FS_CP_EEXIST') {
            throw new Error(`pack: two owners stage the same path under ${relative} — ${error.message}`)
        }

        throw error
    }

    return copied
}

function copyFile(sourceRoot, targetRoot, relative) {
    const
        source = path.join(sourceRoot, relative),
        target = path.join(targetRoot, relative);

    if (!fs.existsSync(source)) {
        throw new Error(`pack: staged file missing in ${sourceRoot}: ${relative}`)
    }

    if (fs.existsSync(target)) {
        throw new Error(`pack: two owners stage the same path: ${relative}`)
    }

    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.copyFileSync(source, target);

    return relative
}

/**
 * @summary Copies every owner's set into the stage — the product's allowlist trees and files from
 * the product root, the Brain's trees from the Brain root — and scans each owner's COPIED files for
 * their bare imports. This is the boundary where provenance is kept: the merged stage cannot show
 * which owner a file came from once both have landed a `src/`, so the scan reads the file sets the
 * copiers returned, never the directory. The instance-overlay stop-line runs here too, before any
 * fresh-config generation, while the walk is cheap.
 * @param {Object} options
 * @param {{brainRoot: String, productRoot: String}} options.roots Resolved by `resolvePackRoots`.
 * @param {String} options.stageDir
 * @returns {{copied: {brain: String[], product: String[]}, scanned: {brain: String[], product: String[]}}}
 */
export function stageOwners({roots, stageDir}) {
    const
        {brain, product} = deriveCopySpecs(),
        copied           = {
            brain  : brain.trees.flatMap(tree => copyTree(roots.brainRoot, stageDir, tree)),
            product: [
                ...product.trees.flatMap(tree => copyTree(roots.productRoot, stageDir, tree)),
                ...product.files.map(file => copyFile(roots.productRoot, stageDir, file))
            ]
        };

    assertNoInstanceOverlays(stageDir);

    return {
        copied,
        scanned: Object.fromEntries(Object.entries(copied).map(([owner, files]) => [owner, collectBarePackages({files, rootDir: stageDir})]))
    }
}

function run(command, args, options = {}) {
    execFileSync(command, args, {stdio: 'inherit', ...options})
}

/**
 * @summary Stages the complete organism from its three owners: the product graph (allowlist-derived)
 * and the Brain set (from the explicit Brain root), the generated dependency manifest + install with
 * its verified closure, the @electron/rebuild attempt (falsifier-gated arm), the pack-time-fresh
 * instance config, and the node shim. Idempotent: the stage dir is rebuilt from scratch — but only
 * once every owner is proven, so a missing authority never leaves a half-staged tree behind.
 * @param {Object} [options]
 * @param {String} [options.electronVersion] Version for @electron/rebuild (harness devDep pin).
 * @param {Object} [options.env=process.env] Carries `NEO_AGENTOS_RUNTIME_ROOT`, the Brain authority.
 * @param {String} [options.productRoot] Defaults to this checkout.
 * @param {String} [options.stageDir=STAGE_DIR]
 * @returns {Object} build info (also written to `<stageDir>/organism-build-info.json`).
 */
export function stageOrganism({electronVersion, env = process.env, productRoot = repoRoot, stageDir = STAGE_DIR} = {}) {
    if (!electronVersion) {
        throw new Error('pack: electronVersion is required — the staged natives MUST target the bundled runtime ABI.')
    }

    const
        roots              = resolvePackRoots({env, productRoot}),
        productPackageJson = readPackageJson(roots.productRoot),
        enginePackageJson  = readPackageJson(roots.enginePackageRoot),
        brainPackageJson   = readPackageJson(roots.brainRoot),
        {brain, product}   = deriveCopySpecs();

    fs.rmSync(stageDir, {force: true, recursive: true});
    fs.mkdirSync(stageDir, {recursive: true});

    // Deterministic asset freshness: the stage copies dist/development/css AS-IS, and a stale
    // build renders the packaged window fully broken while every existence probe stays green
    // (live incident: a theming merge landed after the last local theme build). The artifact
    // never trusts checkout state — it rebuilds.
    console.log('[pack] building dev themes from current SCSS');
    run('node', [path.join(roots.enginePackageRoot, ENGINE_THEME_BUILD), '-f', '-n', '-e', 'dev', '-t', 'all'], {cwd: roots.productRoot});

    const
        {copied, scanned} = stageOwners({roots, stageDir}),
        manifest          = buildOrganismManifest({brainPackageJson, productPackageJson, scanned});

    fs.writeFileSync(path.join(stageDir, 'package.json'), JSON.stringify(manifest, null, 4), 'utf8');

    console.log(`[pack] staged ${copied.product.length} product + ${copied.brain.length} Brain files; installing ${Object.keys(manifest.dependencies).length} organism dependencies`);
    run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], {cwd: stageDir});

    // Mandatory ABI targeting: the staged natives rebuild for the bundled Electron. Failure fails
    // the build — a catch-and-ship here is a silently-broken-artifact vector.
    run('npx', ['@electron/rebuild', '--module-dir', stageDir, '--version', electronVersion], {cwd: harnessDir});

    const buildInfo = {
        electronVersion,
        owners  : describeOwners({brainPackageJson, enginePackageJson, productPackageJson, roots}),
        rebuilt : true,
        stagedAt: new Date().toISOString()
    };

    // Pack-time-fresh instance config: template-current by construction, so the packaged first
    // boot never needs to WRITE into the (possibly read-only, translocated) resources dir. The
    // Brain's setup script fills the slots it knows; the derived pass fills the rest.
    run('node', ['ai/scripts/setup/initServerConfigs.mjs'], {cwd: stageDir});

    const
        trees    = [...product.trees, ...brain.trees],
        filled   = materializeOverlaySlots({stageDir, trees});

    filled.length && console.log(`[pack] materialized ${filled.length} overlay slot(s) the setup script left empty: ${filled.join(', ')}`);

    // The closure is checked on the COMPLETE stage: the configs above are import targets.
    assertImportClosure({manifest, stageDir, trees});

    const shimsDir = path.join(stageDir, 'shims');

    fs.mkdirSync(shimsDir, {recursive: true});
    fs.writeFileSync(path.join(shimsDir, 'node'), buildNodeShim(), {mode: 0o755});

    fs.writeFileSync(path.join(stageDir, 'organism-build-info.json'), JSON.stringify(buildInfo, null, 4), 'utf8');
    console.log(`[pack] organism staged at ${stageDir} (rebuilt=${buildInfo.rebuilt})`);
    return buildInfo
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    const electronVersion = JSON.parse(fs.readFileSync(path.join(harnessDir, 'package.json'), 'utf8')).devDependencies?.electron?.replace(/^[^0-9]*/, '');

    stageOrganism({electronVersion})
}
