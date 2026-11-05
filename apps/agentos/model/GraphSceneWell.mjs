import Model from '../../../node_modules/neo.mjs/src/data/Model.mjs';

/**
 * @class AgentOS.model.GraphSceneWell
 * @extends Neo.data.Model
 *
 * @summary One well of the Observatory's scene, as the layout derived it
 * ({@link AgentOS.util.ObservatorySceneLayout#fromGraphScene}): its hub's origin-qualified id, the key every
 * selection and flight speaks, the name it is drawn with, how many nodes it holds, and whether the strategic
 * walk's cap stopped it.
 */
class GraphSceneWell extends Model {
    static config = {
        /**
         * @member {String} className='AgentOS.model.GraphSceneWell'
         * @protected
         */
        className: 'AgentOS.model.GraphSceneWell',
        /**
         * @member {Object[]} fields
         */
        fields: [{
            name: 'id',
            type: 'String'
        }, {
            name        : 'label',
            type        : 'String',
            defaultValue: null
        }, {
            name        : 'size',
            type        : 'Integer',
            defaultValue: 0
        }, {
            name        : 'full',
            type        : 'Boolean',
            defaultValue: false
        }]
    }
}

export default Neo.setupClass(GraphSceneWell);
