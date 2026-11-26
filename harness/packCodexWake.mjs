import fs                         from 'node:fs';
import {isBuiltin, createRequire} from 'node:module';
import path                       from 'node:path';
import {fileURLToPath}            from 'node:url';

/**
 * @module harness/packCodexWake
 * @summary Declares the build-time inputs for the wake executable independently of package revision metadata.
 */

/** The checkout `install:mac` runs from. Its `neo-agent-brain` is the verifier the installer trusts. */
const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @summary Emits a declaration only for an unsigned package with a Brain that can authenticate its payload. Refuses
 * the build when the installer's trusted verifier could not read that declaration: the install would stop after its Quit.
 * @param {String} root Assembled organism after native dependency staging.
 * @param {String|null} signingIdentity The builder's macOS identity; explicit null selects unsigned packaging.
 * @param {Object} [installer] The installer's runtime-generation module; defaults to this checkout's `neo-agent-brain`.
 * @returns {Promise<String>} The chosen shape for the package build record.
 */
export async function stageCodexWakeArtifact(root, signingIdentity, installer) {
    if (signingIdentity !== null) return 'generation-bound (outer app signing configured)';
    const protocol = path.join(root, 'ai/daemons/wake/codexWakeProtocol.json');
    if (!fs.existsSync(protocol)) return 'generation-bound (legacy Brain)';
    const verifier = createRequire(path.join(root, 'package.json'))('neo-agent-brain/runtime-generation');
    if (typeof verifier.describeCodexWakeArtifact !== 'function') return 'generation-bound (legacy Brain)';
    if (JSON.parse(fs.readFileSync(protocol, 'utf8')).wire !== 'neo-codex-primary-wake-v1') return 'generation-bound (unsupported hook wire)';
    const [{extractLiteralImportSpecifiers, installedRevisionOf}, {verifierReadsWakeVersion}] = await Promise.all([
        import('./pack.mjs'), import('./codexWakeArtifact.mjs')
    ]);
    installer ??= createRequire(import.meta.url)('neo-agent-brain/runtime-generation');
    const version = verifierReadsWakeVersion(verifier, 2) ? 2 : 1;
    if (!verifierReadsWakeVersion(installer, version)) {
        const short = revision => revision?.slice(0, 7) ?? 'unknown';
        let packed;
        try { packed = JSON.parse(fs.readFileSync(path.join(root, 'organism-build-info.json'), 'utf8')).owners?.brain?.revision } catch {}
        throw Error(`afterPack: this organism would declare a Codex wake artifact (Brain ${short(packed)}), but install:mac verifies with ` +
            `neo-agent-brain ${short(installedRevisionOf(productRoot, 'neo-agent-brain'))}, which cannot read it. Run \`npm run resolve-org-dev\` ` +
            'to install the Brain at dev, or move the neo-agent-brain pin in package.json; then build again.')
    }
    const declaration = buildCodexWakeDeclaration(root, source => extractLiteralImportSpecifiers(source, true));
    if (version === 2) {
        const {default: plist} = await import('plist');
        // The carrier omits app.asar. Keep the installed app's own integrity record on its original plist.
        const info = plist.parse(fs.readFileSync(path.resolve(root, '../../Info.plist'), 'utf8'));
        if (typeof info?.CFBundleExecutable !== 'string' || verifier.CODEX_WAKE_ARTIFACT_PLIST !== 'codex-wake-info.plist') {
            throw Error('afterPack: invalid Codex wake carrier plist inputs')
        }
        delete info.ElectronAsarIntegrity;
        fs.writeFileSync(path.join(root, verifier.CODEX_WAKE_ARTIFACT_PLIST), plist.build(info), {flag:'wx'});
        declaration.version = version
    }
    fs.writeFileSync(path.join(root, 'codex-wake-artifact.json'), JSON.stringify(declaration) + '\n', {flag:'wx'});
    return 'immutable hook artifact declared'
}

/**
 * @summary Declares the exact first-party imports and complete installed npm package trees of the packaged wake hook.
 * The installed generation supplies the final signed executable, native libraries and file inventory.
 * @param {String} root Staged organism after dependency installation and ABI rebuild.
 * @param {Function} specifiers Literal import reader which refuses unbounded resolution.
 * @returns {Object} Relocatable v1 input declaration.
 */
export function buildCodexWakeDeclaration(root, specifiers) {
    root = fs.realpathSync(root);
    const files       = new Set(), packages = new Set();
    const namePattern = /^(?:@[a-z0-9_.-]+\/)?[a-z0-9][a-z0-9_.-]*$/;
    const pkg         = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

    function includePackage(from, name, optional = false) {
        if (!namePattern.test(name) || name === pkg.name) throw Error('Unsupported wake package dependency: ' + name);
        let owner = from;
        for (;;) {
            const dir = path.join(owner, 'node_modules', name), manifest = path.join(dir, 'package.json');
            if (fs.existsSync(manifest)) {
                const relative = path.relative(root, dir);
                if (fs.realpathSync(manifest) !== manifest || !relative.startsWith('node_modules/')) throw Error('Noncanonical wake package ' + relative);
                if (packages.has(relative)) return;
                packages.add(relative);
                const metadata = JSON.parse(fs.readFileSync(manifest, 'utf8'));
                for (const dep of new Set([...Object.keys(metadata.dependencies ?? {}), ...Object.keys(metadata.optionalDependencies ?? {}),
                    ...Object.keys(metadata.peerDependencies ?? {})])) {
                    includePackage(dir, dep, dep in (metadata.optionalDependencies ?? {}) || metadata.peerDependenciesMeta?.[dep]?.optional === true)
                }
                return
            }
            if (owner === root) break;
            owner = path.dirname(owner)
        }
        if (!optional) throw Error('Missing wake package ' + name)
    }

    function includeFile(file) {
        const relative = path.relative(root, file);
        if (!/^(?:ai|src)\/.+\.mjs$/.test(relative) || fs.realpathSync(file) !== file) throw Error('Noncanonical wake module ' + relative);
        if (files.has(relative)) return;
        files.add(relative);
        for (const spec of specifiers(fs.readFileSync(file, 'utf8'))) {
            if (isBuiltin(spec)) continue;
            if (spec.startsWith('./') || spec.startsWith('../')) includeFile(path.resolve(path.dirname(file), spec));
            else {
                if (spec.split('/').some(part => !part || part === '.' || part === '..')) throw Error('Invalid wake import ' + spec);
                includePackage(path.dirname(file), spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/'))
            }
        }
    }

    includeFile(path.join(root, 'ai/daemons/wake/codexWakeHook.mjs'));
    return {version:1, wire:'neo-codex-primary-wake-v1', files:[...files].sort(), packages:[...packages].sort()}
}
