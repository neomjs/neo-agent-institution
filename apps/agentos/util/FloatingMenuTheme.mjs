import Base from '../../../node_modules/neo.mjs/src/core/Base.mjs';

/**
 * @summary Projects a button's current skin onto its floating menu.
 *
 * A floating menu is logically parented to its button but DOM-parented to `document.body`, so
 * component.Base suppresses the "inherited" theme class while DOM inheritance comes from the body's own
 * skin. The menu therefore takes the button's resolved theme as its config plus a concrete class, at every
 * open, so a later viewport skin switch reaches it too. The instance switcher and the fleet head's
 * awaiting-merge button share this one seam.
 * @class AgentOS.util.FloatingMenuTheme
 * @extends Neo.core.Base
 */
class FloatingMenuTheme extends Base {
    static config = {
        /**
         * @member {String} className='AgentOS.util.FloatingMenuTheme'
         * @protected
         */
        className: 'AgentOS.util.FloatingMenuTheme'
    }

    /**
     * @summary Give the menu its button's theme, as config and as class.
     * @param {Neo.button.Base} owner The menu's button.
     * @param {Neo.component.Base} menu The floating menu.
     */
    static sync(owner, menu) {
        const
            theme = owner.getTheme(),
            cls   = menu.cls.filter(value => !value.startsWith('neo-theme-'));

        if (theme) {
            menu.theme = theme;
            cls.push(theme)
        }

        menu.cls = cls
    }
}

export default Neo.setupClass(FloatingMenuTheme);
