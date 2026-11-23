// Forward-declared globals (attached to window by their respective .ts modules)
// SidebarManager, TitlebarManager, FileExplorer, SampleTester, CodeComparer,
// DebugPanel, CloudSyncPanel are declared in sidebar.ts / titlebar.ts (script scope).
// TabManager is in tabs.js (not yet migrated to .ts).
declare const TabManager: { new (): { saveAllFiles: () => Promise<{ success: boolean; failures: any[] }>; saveCurrentFile: () => Promise<unknown>; getTabCount: () => number; showWelcomePage: () => void; getUnsavedFiles: () => unknown; tabs: Map<string, unknown>; getTabContentForSave: (tab: unknown) => unknown; saveAsFile: (content: string, filePath?: string) => Promise<unknown>; }; };
declare const OICPPApp: { new (): { init: () => Promise<void>; saveCurrentFile: () => Promise<unknown>; createNewCppFile: () => void; showMessage: (message: string, type?: string) => void; getActiveFilePath: () => string | null; isCloudFilePath: (path: string) => boolean; }; };

const dialogManager = window.dialogManager as { showConfirmDialog: (title: string, msg: string) => Promise<void> } | undefined;

document.addEventListener('DOMContentLoaded', function() {
    const i18n = window.i18n as { init: () => Promise<void>; enableAutoTranslate: () => void; t: (key: string, params?: Record<string, unknown>) => string } | undefined;
    const dialogManager = window.dialogManager as { showNewYearGreeting: (d: Date) => void; showSpringFestivalGreeting: (d: Date) => void; showConfirmDialog: (title: string, msg: string) => Promise<void> } | undefined;
    const _electronAPI: unknown = window.electronAPI;
    const electronAPI = _electronAPI as ({ getUserIconPath: () => Promise<string>; onRequestSaveAll: (cb: () => Promise<unknown>) => void; notifySaveAllFailed: (d: unknown) => void; notifySaveAllComplete: () => void } | undefined);
    logInfo('DOM 加载完成，开始初始化应用...');
    setUserIconPath();
    // Initialize i18n before app
    if (i18n && typeof i18n.init === 'function') {
        i18n.init().then(() => {
            if (typeof i18n.enableAutoTranslate === 'function') {
                i18n.enableAutoTranslate();
            }
        }).catch(err => logError('i18n 初始化失败:', err));
    }
    initializeApp();
    setTimeout(() => {
        try {
            const now = new Date();
            const isNewYearDay = (now.getMonth() === 0 && now.getDate() === 1);
            const isSpringFestivalDay = (now.getMonth() === 1 && now.getDate() === 17);

            if (!dialogManager) return;

            if (isNewYearDay && typeof dialogManager.showNewYearGreeting === 'function') {
                dialogManager.showNewYearGreeting(now);
                return;
            }

            if (isSpringFestivalDay && typeof dialogManager.showSpringFestivalGreeting === 'function') {
                dialogManager.showSpringFestivalGreeting(now);
            }
        } catch (e) {
            try { logWarn('新年弹窗触发失败:', e); } catch (_) { }
        }
    }, 350);
});

async function setUserIconPath() {
    try {
        if (!electronAPI) return;
    const userIconPath = await (window.electronAPI as unknown as { getUserIconPath: () => Promise<string> }).getUserIconPath();
        const appIcon = document.getElementById('app-icon') as HTMLImageElement | null;
        if (appIcon) {
            appIcon.src = userIconPath;
        }
    } catch (error) {
        logWarn('无法加载用户目录中的图标，使用默认图标:', error);
    }
}
async function initializeApp() {
    try {
        logInfo('初始化标题栏管理器...');
        window.titlebarManager = new TitlebarManager();
  
        logInfo('初始化侧边栏管理器...');
        window.sidebarManager = new SidebarManager();
        window.sampleTester = window.sidebarManager.getPanelManager('samples');
        window.codeComparer = window.sidebarManager.getPanelManager('compare');
        window.cloudSyncPanel = window.sidebarManager.getPanelManager('cloud');

        setTimeout(() => {
            window.sidebarManager.updateFileExplorerButtons();
        }, 100);
        logInfo('侧边栏管理器已初始化');
        window.checkSidebarResize = () => {
            if (window.sidebarManager && window.sidebarManager.checkResizeStatus) {
                return window.sidebarManager.checkResizeStatus();
            } else {
                logInfo('侧边栏管理器未找到');
                return null;
            }
        };
        
        logInfo('初始化标签页管理器...');
        window.tabManager = new TabManager();

        logInfo('初始化主应用...');
        window.oicppApp = new OICPPApp();
        logInfo('OICPPApp 实例已创建');
        await window.oicppApp.init();
   
        setupDefaultContent();
        
        logInfo('应用初始化完成！');
        try {
            const ea = window.electronAPI as unknown as { onRequestSaveAll: (cb: () => Promise<unknown>) => void } | undefined;
            if (ea && ea.onRequestSaveAll) {
                ea.onRequestSaveAll(async () => {
                    let result = { success: true, failures: [] };
                    try {
                        if (window.tabManager && typeof window.tabManager.saveAllFiles === 'function') {
                            result = await window.tabManager.saveAllFiles();
                        } else if (window.oicppApp?.saveCurrentFile) {
                            await window.oicppApp.saveCurrentFile();
                        }
                    } catch (e) {
                        result = { success: false, failures: [{ fileName: '', error: e?.message || String(e) }] };
                    }
                    if (result && result.success === false) {
                        const failures = Array.isArray(result.failures) ? result.failures : [];
                        const detail = failures.slice(0, 8)
                            .map(f => `- ${f.fileName || '未命名文件'}：${f.error || '保存失败'}`)
                            .join('\n');
                        const message = `以下文件保存失败，窗口保持打开，请处理后重试：\n${detail || '未知错误'}`;
                        logError('[关闭前保存]', message);
                        try {
                            if (dialogManager?.showConfirmDialog) {
                                dialogManager.showConfirmDialog('保存失败', message).catch(() => { });
                            }
                        } catch (_) { }
                        try { window.electronAPI.notifySaveAllFailed?.({ failures }); } catch (_) { }
                    } else {
                        window.electronAPI.notifySaveAllComplete?.();
                    }
                });
            }
        } catch (e) { logWarn('注册关闭前保存监听失败:', e); }
        
    } catch (error) {
        logError('应用初始化失败:', error);
        showErrorMessage((i18n ? i18n.t('app.appInitFailed', {msg: error.message}) : '应用初始化失败: ' + error.message));
    }
}

function setupDefaultContent() {
    setTimeout(function() {
        try {
            const fileExplorer = window.sidebarManager?.getPanelManager?.('files') as { hasWorkspace?: boolean } | undefined;
            const hasWorkspace = !!(fileExplorer && fileExplorer.hasWorkspace);
            if (hasWorkspace) {
                logInfo('检测到已打开工作区，跳过欢迎页面');
                return;
            }

            if (window.tabManager && typeof window.tabManager.getTabCount === 'function' && window.tabManager.getTabCount() === 0) {
                logInfo('显示欢迎页面...');
                if (typeof window.tabManager.showWelcomePage === 'function') {
                    window.tabManager.showWelcomePage();
                } else {
                    logError('showWelcomePage 方法不存在');
                }
            }
        } catch (error) {
            logError('显示欢迎页面时出错:', error);
            if (window.oicppApp && typeof window.oicppApp.createNewCppFile === 'function') {
                window.oicppApp.createNewCppFile();
            }
        }
    }, 1000); 
}

function showErrorMessage(message) {
    const safeMessage = String(message ?? '').split(/\r?\n/)[0].trim() || '发生错误，请稍后重试';
    try {
        logWarn('[RendererErrorToastSuppressed]', safeMessage);
    } catch (_) {}
}

window.addEventListener('error', function(e) {
    try {
        const info = {
            message: e?.error?.message || e?.message,
            filename: e?.filename,
            lineno: e?.lineno,
            colno: e?.colno,
            stack: e?.error?.stack
        };
        logError('[RendererGlobalError]', info);
    } catch (_) {}
});

window.addEventListener('unhandledrejection', function(e) {
    try {
        const reason = e?.reason;
        const info = reason instanceof Error ? { message: reason.message, stack: reason.stack } : { reason };
        logError('[RendererUnhandledRejection]', info);
        const message = String(reason?.message || reason || '');
        const stack = String(reason?.stack || '');
        if (message === 'Model not found' && stack.includes('startFindDefinition')) {
            return;
        }
    } catch (_) {}
});

window.initializeApp = initializeApp;
