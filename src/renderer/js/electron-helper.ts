(function () {
    'use strict';

    if (typeof window.require === 'function' && !(window as { __electronRequireAvailable?: boolean }).__electronRequireAvailable) {
        return;
    }

    (window as { require?: (module: string) => unknown }).require = function (module: string) {
        if (module === 'electron') {
            if ((window as { getElectronModule?: () => unknown }).getElectronModule) {
                return ((window as { getElectronModule?: () => unknown }).getElectronModule as () => unknown)();
            }
            throw new Error('Electron module not available');
        }
        throw new Error(`Module '${module}' is not available in renderer process`);
    };

    ((window as { require?: (module: string) => unknown }).require as { __electronHelper?: boolean }).__electronHelper = true;

    logInfo('Electron Helper: require函数已设置');
})();