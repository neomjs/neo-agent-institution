import Base from '../../../node_modules/neo.mjs/src/core/Base.mjs';

/**
 * @summary The product's words for what a plane answered when the shell asked it to admit a PAT.
 *
 * One sentence per verdict of the shell's plane probe (`harness/planeConfig.mjs`
 * `probePlaneCredential`). The connect card says them after a Connect, and the spine banner says them
 * after a boot the plane refused, so a failing plane reads the same wherever it fails.
 * @class AgentOS.util.PlaneVerdict
 * @extends Neo.core.Base
 */
class PlaneVerdict extends Base {
    /**
     * The sentence for each probe verdict that refuses a plane.
     * @member {Object} sentences
     * @static
     */
    static sentences = Object.freeze({
        'no-identity': 'The plane accepted that PAT but named no identity for it.',
        'not-a-plane': 'That address is not a Neo plane.',
        rejected     : 'The plane refused that PAT.',
        unreachable  : 'No plane answered at that address.'
    })

    static config = {
        /**
         * @member {String} className='AgentOS.util.PlaneVerdict'
         * @protected
         */
        className: 'AgentOS.util.PlaneVerdict'
    }
}

export default Neo.setupClass(PlaneVerdict);
