import fs   from 'node:fs';
import path from 'node:path';

/**
 * @module harness/wakeReceiver
 * @summary Where the installed shell finds the host wake receiver, so the Fleet it starts can arm the wake
 * route of every GUI seat it launches (the Brain's `armFleetSeatWake`). A Finder-launched app inherits no
 * shell exports, so when the launch carries no receiver, the shell reads the receiver's own LaunchAgent.
 *
 * Settled once per launch, in this order:
 * - the launch environment, when it carries both `NEO_WAKE_RECEIVER_MANIFEST` and `NEO_WAKE_RECEIVER_BASE`
 *   (origin `environment`);
 * - else the receiver's LaunchAgent (origin `launch-agent`). Its `--manifest` is the manifest, and its
 *   `--port` gives the base the dockerized plane reaches, `http://host.docker.internal:<port>`. That base
 *   applies only while the Fleet attaches to a plane on this host: a remote plane cannot reach a host
 *   receiver, and a plane running natively on the host declares its base through the environment;
 * - else none (origin `none`).
 *
 * Anything short of both coordinates passes neither, and the Fleet's seats report `unarmed` with the
 * Brain's own reason. A LaunchAgent that exists but cannot be read is a named refusal, never a guess. It
 * is read as a property list, strictly: a construct a plist reader would skip can never name the
 * receiver, and a document that is not a whole property list refuses.
 */

/**
 * The receiver's LaunchAgent, as the local-agent-os runbook installs it under `~/Library/LaunchAgents`.
 * @type {String}
 */
export const WAKE_RECEIVER_LAUNCH_AGENT = 'com.neomjs.agent-os-wake.plist';

const
    LOCAL_HOSTS  = ['127.0.0.1', 'localhost', '[::1]'],
    // One token per comment, processing instruction, declaration, tag or text run. Anything else (a stray
    // `<`, a CDATA section) matches no token, so the tokens no longer add up to the document.
    PLIST_TOKEN  = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![A-Za-z][^>]*>|<\/?[A-Za-z][^<>]*>|[^<]+/g,
    // the escapes Apple's property-list writer emits
    XML_ENTITIES = {amp: '&', apos: '\'', gt: '>', lt: '<', quot: '"'};

/**
 * @summary Reads an XML property list into plain values, strictly. The XML declaration and the plist
 * DOCTYPE may open it; otherwise nothing stands outside its one `<plist>` root, and no comment or
 * processing instruction stands anywhere, so nothing a plist reader would skip can carry a key. Truncation,
 * duplicate keys, unknown entities and stray text refuse. Strings come back as strings; every other leaf
 * comes back typed, so it can never pass for one.
 * @param {String} xml
 * @returns {Object} The root dictionary.
 * @throws {Error} Naming why the document is not such a property list.
 * @private
 */
function parsePlist(xml) {
    const tokens = xml.match(PLIST_TOKEN) ?? [];

    if (tokens.join('') !== xml) {
        throw new Error('it is not well-formed XML')
    }

    let at = 0;

    const
        fail  = reason => { throw new Error(reason) },
        // Whitespace between elements carries nothing; any other text there is not a property list.
        peek  = () => { while (at < tokens.length && !tokens[at].trim()) at++; return tokens[at] },
        tag   = () => { const token = peek() ?? fail('the document ends early'); at++; return token.startsWith('<') ? token : fail('text stands outside an element') },
        close = name => tag() === `</${name}>` || fail(`<${name}> is not closed`),
        text  = name => {
            const raw = tokens[at]?.startsWith('<') === false ? tokens[at++] : '';

            close(name);
            /&(?!(?:amp|apos|gt|lt|quot);)/.test(raw) && fail('it uses an entity a property list does not');
            return raw.replace(/&(amp|apos|gt|lt|quot);/g, (entity, entityName) => XML_ENTITIES[entityName])
        },
        value = () => {
            const token = tag();

            if (token === '<dict>') {
                const dict = {};

                while (peek() !== '</dict>') {
                    tag() === '<key>' || fail('a dictionary entry has no key');

                    const key = text('key');

                    Object.hasOwn(dict, key) && fail(`the key ${key} appears twice`);
                    dict[key] = value()
                }

                at++;
                return dict
            }

            if (token === '<array>') {
                const array = [];

                while (peek() !== '</array>') array.push(value());

                at++;
                return array
            }

            const [, name, empty] = /^<([a-z]+)(\/?)>$/.exec(token) ?? [];

            if (name === 'true' || name === 'false') return empty ? name === 'true' : fail(`<${name}> must be empty`);
            if (name === 'string') return empty ? '' : text(name);
            if (['data', 'date', 'integer', 'real'].includes(name)) return {[name]: empty ? '' : text(name)};
            if ((name === 'dict' || name === 'array') && empty) return name === 'dict' ? {} : [];

            return fail(`${token.slice(0, 40)} is not a property-list value`)
        };

    // The writer's prolog: the declaration, then the DOCTYPE, then the root.
    if (/^<\?xml\s[^>]*\?>$/.test(peek() ?? '')) at++;
    if (/^<!DOCTYPE\s+plist\b[^>]*>$/.test(peek() ?? '')) at++;

    /^<plist(?:\s+version="1\.0")?\s*>$/.test(tag()) || fail('it has no <plist> root');

    const root = value();

    close('plist');
    peek() === undefined || fail('content follows the </plist> root');

    return root && typeof root === 'object' && !Array.isArray(root) ? root : fail('its root is not a dictionary')
}

/**
 * @summary Whether the Fleet attaches to a plane on this host, which is the dockerized plane the runbook
 * installs. An absent or unparsable plane base is not local.
 * @param {String} [planeBase]
 * @returns {Boolean}
 * @private
 */
function isLocalPlane(planeBase) {
    try {
        return LOCAL_HOSTS.includes(new URL(planeBase).hostname)
    } catch {
        return false
    }
}

/**
 * @summary The receiver's own declaration: the `--manifest` and `--port` its LaunchAgent runs it with.
 * @param {Object} options
 * @param {String} options.plistPath
 * @param {Object} [options.fsModule=fs]
 * @returns {{manifest: String, port: Number}|null} `null` when no LaunchAgent is installed.
 * @throws {Error} When the LaunchAgent exists but does not readably declare both.
 */
export function readReceiverLaunchAgent({plistPath, fsModule = fs}) {
    let xml;

    try {
        xml = fsModule.readFileSync(plistPath, 'utf8')
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return null
        }

        throw new Error(`${plistPath} cannot be read (${error.message})`)
    }

    if (xml.startsWith('bplist')) {
        throw new Error(`${plistPath} is a binary property list; \`plutil -convert xml1\` restores the XML the runbook installs`)
    }

    let plist;

    try {
        plist = parsePlist(xml)
    } catch (error) {
        throw new Error(`${plistPath} is not a whole property list: ${error.message}`)
    }

    const
        declared = plist.ProgramArguments,
        args     = Array.isArray(declared) && declared.every(arg => typeof arg === 'string') ? declared : [],
        after    = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined,
        manifest = after('--manifest'),
        port     = Number(after('--port'));

    if (!path.isAbsolute(manifest ?? '') || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`${plistPath} declares no absolute --manifest and valid --port in its ProgramArguments`)
    }

    return {manifest, port}
}

/**
 * @summary The receiver for this launch, with its origin and, when it is not settled, why.
 * @param {Object} options
 * @param {Object} options.env The launch environment.
 * @param {String} [options.planeBase] The plane the Fleet attaches to, as the Brain resolved it.
 * @param {String} options.plistPath The receiver's LaunchAgent.
 * @param {Object} [options.fsModule=fs]
 * @returns {{origin: String, manifest: String|null, base: String|null, reason: String|null}}
 */
export function settleWakeReceiver({env, planeBase, plistPath, fsModule = fs}) {
    if (env.NEO_WAKE_RECEIVER_MANIFEST && env.NEO_WAKE_RECEIVER_BASE) {
        return {origin: 'environment', manifest: env.NEO_WAKE_RECEIVER_MANIFEST, base: env.NEO_WAKE_RECEIVER_BASE, reason: null}
    }

    const unsettled = (origin, reason) => ({origin, manifest: null, base: null, reason});
    let agent;

    try {
        agent = readReceiverLaunchAgent({plistPath, fsModule})
    } catch (error) {
        return unsettled('launch-agent', error.message)
    }

    if (!agent) {
        return unsettled('none', `neither the launch environment nor ${plistPath} declares a wake receiver`)
    }

    return isLocalPlane(planeBase)
        ? {origin: 'launch-agent', manifest: agent.manifest, base: `http://host.docker.internal:${agent.port}`, reason: null}
        : unsettled('launch-agent', 'the Fleet attaches to no plane on this host, and only a local plane reaches the host receiver')
}

/**
 * @summary The Fleet child's environment fragment. A settled receiver passes both coordinates. A packaged
 * launch that settled none clears both: the child inherits the launch environment beneath this fragment,
 * and half a declaration there would otherwise reach the Fleet while the log says none. `null` (an
 * unpackaged launch) leaves the inherited environment alone.
 * @param {Object|null} receiver A {@link settleWakeReceiver} result, or `null` for an unpackaged launch.
 * @returns {Object}
 */
export function wakeReceiverEnv(receiver) {
    if (!receiver) return {};

    return receiver.manifest && receiver.base
        ? {NEO_WAKE_RECEIVER_BASE: receiver.base, NEO_WAKE_RECEIVER_MANIFEST: receiver.manifest}
        : {NEO_WAKE_RECEIVER_BASE: '', NEO_WAKE_RECEIVER_MANIFEST: ''}
}
