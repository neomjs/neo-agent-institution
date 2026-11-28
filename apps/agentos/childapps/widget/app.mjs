import {resolveStartTheme} from '../../../../node_modules/neo.mjs/src/util/Theme.mjs';
import Viewport from './view/Viewport.mjs';

export const onStart = () => Neo.app({
    appThemeFolder: 'agentos',
    mainView      : {module: Viewport, theme: resolveStartTheme(Neo.windowConfigs?.[Neo.bootingWindowId] || Neo.config)},
    name          : 'AgentOSWidget'
});
