/**
 * @summary The tests' late-render driver: loaded into the App worker through `Neo.worker.App.loadModule`, it holds
 * every vdom batch the App worker sends for `delay` ms before it leaves for the VDom worker, the way a busy machine
 * stretches the round trip. A spec can then witness what reads the DOM before a render has landed. `delay=0` restores
 * the original sender.
 *
 * Query: `delay=<ms>`.
 */
const
    delay  = Number(new URL(import.meta.url).searchParams.get('delay')) || 0,
    helper = Neo.vdom.Helper,
    send   = helper.lateRenderSend ?? helper.updateBatch;

if (delay > 0) {
    helper.lateRenderSend = send;
    helper.updateBatch    = (...args) => new Promise(resolve => setTimeout(resolve, delay)).then(() => send.apply(helper, args))
} else {
    helper.updateBatch = send;
    delete helper.lateRenderSend
}
