import Base from '../../../node_modules/neo.mjs/src/core/Base.mjs';

/**
 * @module apps/agentos/util/ClosedShape
 * @summary Lands a wire answer in a provider leaf's declared shape.
 *
 * A leaf that holds a whole wire envelope must be closed, because `setData` drills object values into
 * leaf paths. A block written as `null` stops the ancestor rebuild for every later write beneath it,
 * and a key that an answer omits keeps the previous answer's value. So a landed envelope carries every
 * declared key: an absent block lands as its blank, an absent leaf as `null`, and an absent list as `[]`.
 */

/**
 * Static projection onto a declared shape.
 * @class AgentOS.util.ClosedShape
 * @extends Neo.core.Base
 */
class ClosedShape extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.util.ClosedShape'
         * @protected
         */
        className: 'AgentOS.util.ClosedShape'
    }

    /**
     * @summary Projects one wire block onto its declared shape: `null` in the shape marks a leaf, `[]`
     * an atomic list, an object a block. A leaf keeps a string, a finite number or a boolean, a list
     * keeps an array (items stay exactly as written), and anything else lands as the blank.
     * @param {*} block
     * @param {Object} shape
     * @returns {Object}
     */
    static project(block, shape) {
        return Object.fromEntries(Object.entries(shape).map(([key, blank]) => {
            const value = block?.[key];

            if (Array.isArray(blank)) return [key, Array.isArray(value) ? value : []];
            if (blank)                return [key, ClosedShape.project(value && typeof value === 'object' ? value : null, blank)];

            return [key, typeof value === 'string' || typeof value === 'boolean' || Number.isFinite(value) ? value : null]
        }))
    }
}

export default Neo.setupClass(ClosedShape);
