/**
 * @module harness/credentialPrompt
 * @summary The window in which the packaged shell asks for a credential: a native password field in
 * a window of its own. The cockpit's renderer and the App Worker never hold the credential.
 *
 * The field is the platform's own, so macOS turns on Secure Event Input while it has focus (typed
 * keys stay invisible to processes holding Input Monitoring), and caret, selection and undo come
 * with it. The document carries no script, and its policy allows none. A
 * preload that belongs to this window alone hands the value to main once, on submit, over the
 * window's own `webContents.ipc`, and main destroys the window on every settle path.
 */

/**
 * @type {Number}
 */
export const MAX_CREDENTIAL_LENGTH = 1024;

/**
 * The channels between the window's preload and main: `submit` carries the value once, `action`
 * carries `cancel` or `paste`, `size` carries the document's natural height once.
 * @type {{action: String, size: String, submit: String}}
 */
export const PROMPT_CHANNELS = Object.freeze({
    action: 'credential-prompt-action',
    size  : 'credential-prompt-size',
    submit: 'credential-prompt-submit'
});

/**
 * The window's content area in CSS pixels. The height starts at a value the known content fits, and
 * is then set to the document's own measured height, within `minHeight`…`maxHeight`.
 * @type {{height: Number, maxHeight: Number, minHeight: Number, width: Number}}
 */
export const PROMPT_SIZE = Object.freeze({height: 320, maxHeight: 720, minHeight: 200, width: 540});

/**
 * @summary The content height a size report may set: the measured height rounded up and clamped to
 * the band, or `null` for anything that is not a positive finite number.
 * @param {*} value What the window's preload reported.
 * @returns {Number|null}
 */
export function acceptContentHeight(value) {
    if (!Number.isFinite(value) || value <= 0) return null;

    return Math.min(PROMPT_SIZE.maxHeight, Math.max(PROMPT_SIZE.minHeight, Math.ceil(value)))
}

/**
 * What the field asks for. A plane signs in with the forge its repositories live on, so the label
 * names both.
 * @type {String}
 */
export const CREDENTIAL_LABEL = 'GitHub or GitLab PAT';

/**
 * The submit button's text, keyed by the credential-bearing request.
 * @type {Object}
 */
const SUBMIT_TEXT = {
    connectTenant : 'Admit',
    defineAgent   : 'Add agent',
    'plane-attach': 'Connect'
};

/**
 * @summary The credential a submit may settle with: trimmed, non-empty and within the cap, or `null`,
 * which keeps the window open.
 * @param {*} value What the window's preload sent.
 * @returns {String|null}
 */
export function acceptSubmittedCredential(value) {
    if (typeof value !== 'string') return null;

    const credential = value.trim();

    return credential && credential.length <= MAX_CREDENTIAL_LENGTH ? credential : null
}

/**
 * @summary The page the window loads: a heading, the password field with a Paste button, and the
 * Cancel and submit buttons.
 * @param {Object} options
 * @param {String} options.label What the field asks for, e.g. {@link CREDENTIAL_LABEL}.
 * @param {String} options.submit The submit button's text.
 * @returns {String}
 */
export function renderCredentialPromptDocument({label, submit}) {
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Enter ${label}</title><style>
*{box-sizing:border-box}
body{background:#151922;color:#edf2ff;font:14px/1.5 system-ui,sans-serif;margin:0;padding:28px 32px}
h1{font-size:18px;font-weight:600;margin:0 0 6px}
p{color:#b9c4d8;margin:0 0 18px}
label{display:block;font-size:12px;font-weight:600;margin:0 0 6px}
.field{display:flex;gap:8px}
input{background:#0e1118;border:1px solid #3a4458;border-radius:6px;color:#edf2ff;flex:1;font:inherit;height:36px;padding:0 12px}
input:focus{border-color:#4f7cff;box-shadow:0 0 0 3px rgba(79,124,255,.25);outline:none}
input::placeholder{color:#8ea4c8}
button{background:#232a38;border:1px solid #3a4458;border-radius:6px;color:#edf2ff;cursor:pointer;font:inherit;padding:5px 14px}
button:hover{background:#2c3547}
button:disabled{cursor:default;opacity:.45}
footer{display:flex;gap:10px;justify-content:flex-end;margin-top:22px}
.primary{background:#4f7cff;border-color:#4f7cff;font-weight:600}
.primary:hover:not(:disabled){background:#3d6af0}
</style></head><body>
<form>
<h1>Enter your ${label}</h1>
<p>Use the one your team's plane signs in with. Only this app's main process receives it.</p>
<label for="credential">${label}</label>
<div class="field"><input id="credential" type="password" autocomplete="off" spellcheck="false" maxlength="${MAX_CREDENTIAL_LENGTH}" placeholder="Paste with ⌘V, or type" autofocus><button type="button" data-action="paste">Paste</button></div>
<footer><button type="button" data-action="cancel">Cancel</button><button type="submit" class="primary" disabled>${submit}</button></footer>
</form>
</body></html>`
}

/**
 * @summary Creates the prompt the plane broker and the Fleet capability share.
 * @param {Object} options
 * @param {Function} options.BrowserWindow Electron `BrowserWindow`.
 * @param {Object} options.Menu Electron `Menu`, for the field's right-click menu.
 * @param {String} options.preloadPath Absolute path of `credentialPrompt.preload.cjs`.
 * @returns {Function} `({event, method}) => Promise<String|null>`: the credential, or `null` when canceled.
 */
export function createCredentialPrompt({BrowserWindow, Menu, preloadPath}) {
    return function promptCredential({event, method}) {
        const
            text   = {label: CREDENTIAL_LABEL, submit: SUBMIT_TEXT[method] || SUBMIT_TEXT['plane-attach']},
            parent = BrowserWindow.fromWebContents(event.sender),
            win    = new BrowserWindow({
                backgroundColor: '#151922',
                fullscreenable : false,
                height         : PROMPT_SIZE.height,
                maximizable    : false,
                minimizable    : false,
                modal          : Boolean(parent),
                parent         : parent?.isDestroyed() ? undefined : parent,
                resizable      : false,
                show           : false,
                title          : `Enter ${text.label}`,
                // the size is the page's, with or without a title bar (modal on macOS is a sheet)
                useContentSize : true,
                width          : PROMPT_SIZE.width,
                webPreferences : {
                    contextIsolation: true,
                    nodeIntegration : false,
                    preload         : preloadPath,
                    sandbox         : true,
                    webSecurity     : true
                }
            }),
            contents = win.webContents;

        return new Promise(resolve => {
            let settled = false;

            const complete = value => {
                if (settled) return;

                settled = true;
                !win.isDestroyed() && win.destroy();
                resolve(value)
            };

            contents.ipc.on(PROMPT_CHANNELS.submit, (ipcEvent, value) => {
                const credential = acceptSubmittedCredential(value);

                credential && complete(credential)
            });

            // the window fits its content, so no wording, font or label length scrolls the page
            contents.ipc.once(PROMPT_CHANNELS.size, (ipcEvent, value) => {
                const height = acceptContentHeight(value);

                height && !win.isDestroyed() && win.setContentSize(PROMPT_SIZE.width, height)
            });

            contents.ipc.on(PROMPT_CHANNELS.action, (ipcEvent, action) => {
                if (action === 'cancel') complete(null);
                // the browser's own Paste command, the one ⌘V reaches through the Edit menu
                else if (action === 'paste') contents.paste()
            });

            contents.on('context-menu', () => {
                Menu.buildFromTemplate([{role: 'paste'}, {role: 'selectAll'}]).popup({window: win})
            });

            win.once('closed', () => complete(null));
            contents.once('render-process-gone', () => complete(null));
            win.once('ready-to-show', () => {
                win.show();
                win.focus()
            });
            win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(renderCredentialPromptDocument(text))).catch(() => complete(null))
        })
    }
}
