export {};

class OICPPApp {
    currentFile: string | null = null;
    files = new Map<string, unknown>();
    settings: Record<string, unknown> = {
        theme: 'dark',
        fontSize: 14,
        terminalFontSize: 14,
        syntaxCheckEnabled: true,
        syntaxColorsByTheme: {},
        syntaxFontStyles: {},
        tabSize: 4,
        formatterIndentStyle: 'editor',
        clangFormatStyle: null,
        clangFormatRaw: '',
        wordWrap: false,
        enableAutoCompletion: true,
        glassEffectEnabled: false
    };
    editorManager: unknown = null;
    initialized = false;
    accountLoggedIn = false;
    accountInfo: Record<string, unknown> | null = null;
    _accountIpcBound = false;
    isDebugging = false;
    _autoContinueOnStart = false;
    _debugSessionId = 0;
    _debugExited = false;
    _debugTerminalId: string | null = null;
    _debugTerminalBridgeEnabled = false;
    _debugSessionTerminalId: string | null = null;
    terminalPanel: unknown = null;
    updateDownloadState: Record<string, unknown> = {
        autoChecking: false,
        downloading: false,
        version: '',
        progress: 0,
        pendingInstall: false,
        pendingVersion: ''
    };
    autoSaveController: Record<string, unknown> = {
        timerId: null,
        enabled: true,
        intervalMs: 60000,
        running: false
    };
    supportedDropTextExtensions = new Set<string>(['cpp', 'c', 'cc', 'cxx', 'h', 'hpp', 'hh', 'txt', 'in', 'out', 'ans', 'md', 'json']);
    _isWindowsPlatform: boolean | undefined = undefined;
    _isMacPlatform: boolean | undefined = undefined;
    _pendingCtrlKFolderTimer: ReturnType<typeof setTimeout> | null = null;
    _ctrlKChordPending = false;

    t(key: string, params?: Record<string, unknown>, fallback?: string): string {
        return window.i18n?.t?.(key, params) || fallback || key;
    }

    async init() {
        try {
            logInfo('开始初始化 OICPP App...');
        } catch (error) {
            logError('OICPP App 初始化失败:', error);
        }
    }

    escapeHtml(text: string) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    escapeAttribute(text: string) {
        return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    showMessage(message: string, type?: string) {
        logInfo(`[OICPP App][${type || 'info'}] ${message}`);
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const oicppApp = new OICPPApp();
    (window as unknown as { oicppApp?: OICPPApp }).oicppApp = oicppApp;
});
