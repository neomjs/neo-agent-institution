import {expect, test} from '@playwright/test';
import {EventEmitter} from 'node:events';
import {readFile}     from 'node:fs/promises';
import vm             from 'node:vm';
import {
    acceptSubmittedCredential,
    createCredentialPrompt,
    CREDENTIAL_LABEL,
    MAX_CREDENTIAL_LENGTH,
    PROMPT_CHANNELS,
    renderCredentialPromptDocument
} from '../../../../harness/credentialPrompt.mjs';

const
    PAT         = 'ghp_promptFixture000000000000000000000000',
    preloadPath = new URL('../../../../harness/credentialPrompt.preload.cjs', import.meta.url);

/**
 * @summary An Electron `BrowserWindow` double: records its options and loaded URL, owns a
 * `webContents` whose `ipc` is its own emitter, and settles `loadURL` the way the test says.
 * @param {Object} [options={}]
 * @param {Object|null} [options.parent=null] What `fromWebContents` answers.
 * @param {Boolean} [options.loadFails=false]
 * @returns {{FakeWindow: Function, windows: Object[]}}
 */
function fakeElectron({parent = null, loadFails = false} = {}) {
    const windows = [];

    class FakeWindow extends EventEmitter {
        static fromWebContents() {
            return parent
        }

        constructor(options) {
            super();
            this.options     = options;
            this.destroyed   = false;
            this.webContents = Object.assign(new EventEmitter(), {
                ipc       : new EventEmitter(),
                pasteCalls: 0,
                paste() { this.pasteCalls++ }
            });
            windows.push(this)
        }

        destroy() {
            this.destroyed = true
        }

        focus() {}

        isDestroyed() {
            return this.destroyed
        }

        loadURL(url) {
            this.url = url;
            return loadFails ? Promise.reject(new Error('load failed')) : Promise.resolve()
        }

        show() {}
    }

    return {FakeWindow, windows}
}

/**
 * @summary Opens one prompt against the doubles and hands back its window and settle promise.
 * @param {Object} [options={}] Forwarded to {@link fakeElectron}, plus `method`.
 * @returns {{settled: Promise, win: Object}}
 */
function openPrompt({method = 'plane-attach', ...options} = {}) {
    const
        {FakeWindow, windows} = fakeElectron(options),
        prompt                = createCredentialPrompt({BrowserWindow: FakeWindow, Menu: {}, preloadPath: '/shell/credentialPrompt.preload.cjs'}),
        settled               = prompt({event: {sender: {}}, method});

    return {settled, win: windows[0]}
}

/**
 * @summary Races a promise against one macrotask, so a test can assert it is still pending.
 * @param {Promise} promise
 * @returns {Promise<*>} The settled value, or the string `'pending'`.
 */
function pendingOr(promise) {
    return Promise.race([promise, new Promise(resolve => setTimeout(() => resolve('pending'), 0))])
}

test.describe('harness/credentialPrompt — the shell\'s one credential window', () => {
    test('a submit settles only with a trimmed, non-empty credential within the cap', () => {
        expect(acceptSubmittedCredential(`  ${PAT}\n`)).toBe(PAT);
        expect(acceptSubmittedCredential('x'.repeat(MAX_CREDENTIAL_LENGTH))).toHaveLength(MAX_CREDENTIAL_LENGTH);

        for (const value of ['', '   \n', 'x'.repeat(MAX_CREDENTIAL_LENGTH + 1), null, undefined, 42, {PAT}]) {
            expect(acceptSubmittedCredential(value)).toBeNull()
        }
    });

    test('the document is one native password field and carries no script', () => {
        const html = renderCredentialPromptDocument({label: CREDENTIAL_LABEL, submit: 'Connect'});

        expect(html.match(/<input/g)).toHaveLength(1);
        expect(html).toContain(`type="password" autocomplete="off" spellcheck="false" maxlength="${MAX_CREDENTIAL_LENGTH}"`);
        expect(html).not.toMatch(/<script/i);
        expect(html).toContain('content="default-src \'none\'; style-src \'unsafe-inline\'"');
        expect(html).toContain('<label for="credential">GitHub or GitLab PAT</label>');
        expect(html).toContain('<button type="submit" class="primary" disabled>Connect</button>');
        expect(html).toContain('data-action="paste"');
        expect(html).toContain('data-action="cancel"')
    });

    test('the window is sandboxed, isolated, preloaded, and loads exactly that document', () => {
        const {win} = openPrompt({method: 'connectTenant'});

        expect(win.options.webPreferences).toEqual({
            contextIsolation: true,
            nodeIntegration : false,
            preload         : '/shell/credentialPrompt.preload.cjs',
            sandbox         : true,
            webSecurity     : true
        });
        expect(win.options.title).toBe('Enter GitHub or GitLab PAT');
        expect(win.options.modal).toBe(false);
        expect(decodeURIComponent(win.url.replace('data:text/html;charset=utf-8,', ''))).toBe(
            renderCredentialPromptDocument({label: CREDENTIAL_LABEL, submit: 'Admit'})
        )
    });

    test('a live parent makes the window modal to it', () => {
        const parent = {isDestroyed: () => false}, {win} = openPrompt({parent});

        expect(win.options.modal).toBe(true);
        expect(win.options.parent).toBe(parent)
    });

    test('submit settles with the credential once and destroys the window', async () => {
        const {settled, win} = openPrompt();

        win.webContents.ipc.emit(PROMPT_CHANNELS.submit, {}, `${PAT} `);
        win.webContents.ipc.emit(PROMPT_CHANNELS.submit, {}, 'a-second-submit');

        await expect(settled).resolves.toBe(PAT);
        expect(win.destroyed).toBe(true)
    });

    test('a blank submit keeps the window open', async () => {
        const {settled, win} = openPrompt();

        win.webContents.ipc.emit(PROMPT_CHANNELS.submit, {}, '   ');

        expect(await pendingOr(settled)).toBe('pending');
        expect(win.destroyed).toBe(false)
    });

    test('Paste runs the browser\'s own Paste command and settles nothing', async () => {
        const {settled, win} = openPrompt();

        win.webContents.ipc.emit(PROMPT_CHANNELS.action, {}, 'paste');

        expect(win.webContents.pasteCalls).toBe(1);
        expect(await pendingOr(settled)).toBe('pending')
    });

    for (const [path, settle] of [
        ['Cancel',                win => win.webContents.ipc.emit(PROMPT_CHANNELS.action, {}, 'cancel')],
        ['closing the window',    win => win.emit('closed')],
        ['a renderer crash',      win => win.webContents.emit('render-process-gone')],
        ['an unknown intent then closing', win => {
            win.webContents.ipc.emit(PROMPT_CHANNELS.action, {}, 'submit');
            win.emit('closed')
        }]
    ]) {
        test(`${path} settles null and destroys the window`, async () => {
            const {settled, win} = openPrompt();

            settle(win);

            await expect(settled).resolves.toBeNull();
            expect(win.destroyed).toBe(true)
        })
    }

    test('a document that fails to load settles null', async () => {
        const {settled, win} = openPrompt({loadFails: true});

        await expect(settled).resolves.toBeNull();
        expect(win.destroyed).toBe(true)
    });
});

/**
 * @summary A DOM element double with listeners, `closest()` over a parent chain, and `dataset`.
 * @param {Object} [props={}]
 * @returns {Object}
 */
function element(props = {}) {
    const listeners = {};

    return {
        dataset: {},
        parent : null,
        ...props,
        addEventListener(type, fn) { (listeners[type] ??= []).push(fn) },
        closest(selector) {
            const attr = selector.match(/^\[data-(\w+)\]$/)?.[1];

            for (let node = this; node; node = node.parent) {
                if (attr && node.dataset[attr] !== undefined) return node
            }

            return null
        },
        dispatch(type, event = {}) {
            for (const fn of listeners[type] ?? []) fn({preventDefault() {}, target: this, ...event})
        },
        focus() { this.focused = true }
    }
}

/**
 * @summary Runs the preload against DOM and `ipcRenderer` doubles, then fires `DOMContentLoaded`.
 * @returns {Promise<Object>} The doubles and every message the preload sent.
 */
async function loadPreload() {
    const
        sent   = [],
        input  = element({id: 'credential', value: ''}),
        submit = element({disabled: true}),
        paste  = element({dataset: {action: 'paste'}}),
        cancel = element({dataset: {action: 'cancel'}}),
        form   = element({querySelector: selector => selector === '[type="submit"]' ? submit : null}),
        win    = element();

    vm.runInNewContext(await readFile(preloadPath, 'utf8'), {
        document: {
            getElementById: id => id === 'credential' ? input : null,
            querySelector : selector => selector === 'form' ? form : null
        },
        require(name) {
            if (name !== 'electron') throw new Error(`unexpected preload dependency: ${name}`);

            return {ipcRenderer: {send: (...args) => sent.push(args)}}
        },
        window: win
    });

    win.dispatch('DOMContentLoaded');

    return {cancel, form, input, paste, sent, submit, win}
}

test.describe('harness/credentialPrompt.preload — the window\'s own wiring', () => {
    test('the preload speaks exactly the channels main listens on', async () => {
        const source = await readFile(preloadPath, 'utf8');

        expect(source).toContain(`'${PROMPT_CHANNELS.submit}'`);
        expect(source).toContain(`'${PROMPT_CHANNELS.action}'`)
    });

    test('typing enables the submit button only for a non-blank value', async () => {
        const {input, submit} = await loadPreload();

        input.value = '  ';
        input.dispatch('input');
        expect(submit.disabled).toBe(true);

        input.value = PAT;
        input.dispatch('input');
        expect(submit.disabled).toBe(false)
    });

    test('a submit hands the value to main once and clears the field', async () => {
        const {form, input, sent, submit} = await loadPreload();

        input.value = PAT;
        form.dispatch('submit');

        expect(sent).toEqual([[PROMPT_CHANNELS.submit, PAT]]);
        expect(input.value).toBe('');
        expect(submit.disabled).toBe(true);

        form.dispatch('submit');
        expect(sent).toHaveLength(1)
    });

    test('Paste and Cancel reach main as intents, with the field focused', async () => {
        const {cancel, form, input, paste, sent} = await loadPreload();

        form.dispatch('click', {target: paste});
        form.dispatch('click', {target: cancel});
        form.dispatch('click', {target: element()});

        expect(sent).toEqual([[PROMPT_CHANNELS.action, 'paste'], [PROMPT_CHANNELS.action, 'cancel']]);
        expect(input.focused).toBe(true)
    });

    test('Escape cancels; other keys stay in the page', async () => {
        const {sent, win} = await loadPreload();

        win.dispatch('keydown', {key: 'a'});
        win.dispatch('keydown', {key: 'Escape'});

        expect(sent).toEqual([[PROMPT_CHANNELS.action, 'cancel']])
    });
});
