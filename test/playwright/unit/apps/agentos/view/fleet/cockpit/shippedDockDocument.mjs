/**
 * The document the Fleet Cockpit shipped before it declared itself — `neo.dock.zone.v1`, authored
 * by hand as `CockpitDockDocument.create()` up to engine pin 7. The cockpit's `panes` + `zones`
 * declaration must lower to it node-for-node (`declaration.spec.mjs` pins that): the perspective
 * presets and every persisted perspective key these node ids.
 *
 * A factory returning a FRESH object per call — never a shared mutable singleton — so a spec that
 * mutates its copy (a preset variant, a committed operation) never aliases another arm's input.
 * @returns {Object} a fresh `neo.dock.zone.v1` document
 */
export function shippedDockDocument() {
    return {
        schema: 'neo.dock.zone.v1',
        root  : 'cockpit-root',
        items : {
            fleet       : {reference: 'fleet-grid',       title: 'Fleet'},
            stream      : {reference: 'activity-stream',  title: 'Activity'},
            memories    : {reference: 'memories',         title: 'Memories'},
            tasks       : {reference: 'tasks',            title: 'Tasks'},
            operator    : {reference: 'operator-mailbox', title: 'Mailbox'},
            catchUp     : {reference: 'catch-up',         title: 'Catch up'},
            detail      : {reference: 'agent-detail',     title: 'Agent detail', autoHidden: true},
            perspectives: {reference: 'perspectives',     title: 'Perspectives', autoHidden: true},
            defineAgent : {reference: 'define-agent',     title: 'Add agent',    autoHidden: true},
            wakeRoutes  : {reference: 'wakeRoutes',       title: 'Wake routes',  autoHidden: true}
        },
        nodes: {
            'cockpit-root'  : {type: 'edge-zone', zones: {center: {nodeId: 'primary-split'}, right: {nodeId: 'secondary-rail', extent: 0.25, resizable: true}}},
            'primary-split' : {type: 'split', orientation: 'vertical', children: ['fleet-tabs', 'stream-tabs'], sizes: [0.6078, 0.3922]},
            'fleet-tabs'    : {type: 'tabs', items: ['fleet'], activeItemId: 'fleet'},
            'stream-tabs'   : {type: 'tabs', items: ['stream', 'tasks', 'memories', 'operator', 'catchUp'], activeItemId: 'stream'},
            'secondary-rail': {type: 'tabs', items: ['detail', 'perspectives', 'defineAgent', 'wakeRoutes'], activeItemId: 'detail'}
        }
    }
}

/**
 * The cockpit's declared pane configs as the engine captures them at construct — a deep clone with
 * a runtime `id` per pane — so a bare spy host (`Object.create(prototype)`) can answer the engine's
 * `resolvePane` the way a constructed cockpit does.
 * @param {Function} cls The cockpit class whose `static config.panes` is read.
 * @param {Object} Neo The engine namespace (for `Neo.clone` / `Neo.getId`).
 * @returns {Object}
 */
export function declaredPanes(cls, Neo) {
    const declarations = Neo.clone(cls.config.panes, true, true);

    Object.values(declarations).forEach(pane => { pane.id ||= Neo.getId('dock-pane') });

    return declarations
}
