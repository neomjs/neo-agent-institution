/**
 * @module apps/agentos/config/deploymentServiceLabels
 * @summary The Fleet Manager's product names for the connected instance's deployment services — the
 * compose ids the orchestrator observes (`chroma`, `mc-server`, …) rendered as the names an operator
 * knows, with the id kept beside the name because docker compose correlates on ids. A vocabulary table
 * by design: the deploy definitions carry no titles and the Brain has no service catalog; when one
 * grows, a `label` rides the wire and this table retires. An unknown id renders as itself — the
 * table never guesses a name.
 */

/**
 * Product name per compose service id.
 * @type {Readonly<Object<String, String>>}
 */
export const DEPLOYMENT_SERVICE_LABELS = Object.freeze({
    'chroma'      : 'Chroma · vector store',
    'fleet-server': 'Fleet server',
    'ingress'     : 'Ingress · Caddy',
    'kb-server'   : 'Knowledge Base',
    'mc-server'   : 'Memory Core',
    'orchestrator': 'Orchestrator'
});

/**
 * @summary The name a plane card shows for one compose service id — the table's word, or the id itself.
 * @param {String|null} serviceKey
 * @returns {String}
 */
export function labelForDeploymentService(serviceKey) {
    return (typeof serviceKey === 'string' && DEPLOYMENT_SERVICE_LABELS[serviceKey]) || serviceKey || 'unnamed service'
}
