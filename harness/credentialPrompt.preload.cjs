const {ipcRenderer} = require('electron');

// The credential window's own preload (credentialPrompt.mjs). The page has no script, so this
// isolated world wires the form: Enter or the submit button hands the value to main once and
// clears the field, Escape or Cancel cancels, Paste asks main for the browser's Paste command.
// It also reports the document's natural height once, so main can fit the window to it.
// The channel names mirror PROMPT_CHANNELS: a sandboxed preload cannot import that ES module.
window.addEventListener('DOMContentLoaded', () => {
    const
        form   = document.querySelector('form'),
        input  = document.getElementById('credential'),
        submit = form.querySelector('[type="submit"]');

    // the body's own height (content + padding), not the viewport's, so the window can shrink too
    ipcRenderer.send('credential-prompt-size', document.body.scrollHeight);

    input.addEventListener('input', () => {
        submit.disabled = !input.value.trim()
    });

    form.addEventListener('submit', event => {
        event.preventDefault();

        const value = input.value;

        input.value     = '';
        submit.disabled = true;
        value.trim() && ipcRenderer.send('credential-prompt-submit', value)
    });

    form.addEventListener('click', event => {
        const action = event.target.closest('[data-action]')?.dataset.action;

        if (action) {
            input.focus();
            ipcRenderer.send('credential-prompt-action', action)
        }
    });

    window.addEventListener('keydown', event => {
        event.key === 'Escape' && ipcRenderer.send('credential-prompt-action', 'cancel')
    })
});
