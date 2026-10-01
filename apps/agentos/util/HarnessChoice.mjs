import Base from '../../../node_modules/neo.mjs/src/core/Base.mjs';
import {
    listHarnessProducts,
    resolveHarnessType
} from '../../../node_modules/neo-agent-brain/src/fleet/contract/index.mjs';

/**
 * How a harness runs, in the words the operator picks between.
 * @member {Object} RUNS_AS_LABELS
 */
const RUNS_AS_LABELS = Object.freeze({app: 'App', cli: 'Command line'});

/**
 * @summary The operator's harness choice: a product first, then App or Command line only where the
 * product ships both. The catalog's harness types stay the stored and launched unit. This util maps
 * between the two, so the add-agent form and the configuration card offer the same choice.
 *
 * Every answer derives from the Brain's public Fleet contract (`listHarnessProducts`,
 * `resolveHarnessType`). An unknown type has no choice, and an unknown product resolves to `null`.
 * @class AgentOS.util.HarnessChoice
 * @extends Neo.core.Base
 */
class HarnessChoice extends Base {
    static RUNS_AS_LABELS = RUNS_AS_LABELS

    static config = {
        /**
         * @member {String} className='AgentOS.util.HarnessChoice'
         * @protected
         */
        className: 'AgentOS.util.HarnessChoice'
    }

    /**
     * @summary The product and run mode one harness type stands for.
     * @param {String|null} type A harness type, e.g. `codex-desktop`.
     * @returns {{product: String, runsAs: String|null}|null} `null` for a type the catalog does not know.
     */
    static choiceOf(type) {
        const entry = resolveHarnessType(type);

        return entry ? {product: entry.product, runsAs: entry.runsAs} : null
    }

    /**
     * @summary The products in catalog order, each with its run-mode choices: two entries for a
     * product that ships an app and a command line, none for a product with one type.
     * @returns {{product: String, label: String, defaultType: String, runsAs: {runsAs: String, label: String, type: String}[]}[]}
     */
    static products() {
        return listHarnessProducts().map(({product, label, types}) => ({
            product,
            label,
            defaultType: types[0].type,
            runsAs     : types.length < 2 ? [] : types.map(entry => ({
                runsAs: entry.runsAs,
                label : RUNS_AS_LABELS[entry.runsAs] ?? entry.label,
                type  : entry.type
            }))
        }))
    }

    /**
     * @summary The harness type to store when the operator picks a product. The current run mode
     * survives the switch when the new product offers it, so Claude App → Codex lands on Codex's app.
     * @param {String} product
     * @param {String|null} [runsAs] The run mode to keep, when the product has it.
     * @returns {String|null} `null` for an unknown product.
     */
    static typeFor(product, runsAs=null) {
        const entry = listHarnessProducts().find(item => item.product === product);

        if (!entry) {
            return null
        }

        return (entry.types.find(item => item.runsAs === runsAs) ?? entry.types[0]).type
    }

    /**
     * @summary One line naming a stored harness the way the choice offers it: the product, then
     * the run mode when the product ships both.
     * @param {String|null} type
     * @returns {String|null} `null` for a type the catalog does not know.
     */
    static describe(type) {
        const
            choice  = HarnessChoice.choiceOf(type),
            product = choice && HarnessChoice.products().find(item => item.product === choice.product);

        if (!product) {
            return null
        }

        return product.runsAs.length ? `${product.label} · ${RUNS_AS_LABELS[choice.runsAs]}` : product.label
    }
}

export default Neo.setupClass(HarnessChoice);
