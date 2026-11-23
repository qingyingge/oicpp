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
    compilerManager: unknown = null;
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
            const w = window as unknown as Record<string, unknown>;
            if (typeof w.MonacoEditorManager !== 'undefined') {
                const MonacoEditorManagerCtor = w.MonacoEditorManager as new (...args: unknown[]) => unknown;
                this.editorManager = new MonacoEditorManagerCtor();
                window.editorManager = this.editorManager;
                window.monacoEditorManager = this.editorManager;
            } else {
                logError('MonacoEditorManager 类未定义');
                return;
            }

            if (typeof w.CompilerManager !== 'undefined') {
                const CompilerManagerCtor = w.CompilerManager as new (...args: unknown[]) => unknown;
                this.compilerManager = new CompilerManagerCtor();
                window.compilerManager = this.compilerManager;
            }

            let attempts = 0;
            while (attempts < 100) {
                if (this.editorManager && typeof (this.editorManager as Record<string, unknown>).isInitialized === 'boolean' && (this.editorManager as Record<string, unknown>).isInitialized) {
                    logInfo('编辑器管理器初始化完成');
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, 50));
                attempts++;
            }

            if (attempts >= 100) {
                logWarn('编辑器管理器初始化超时，继续其他初始化...');
            }

            this.setupEventListeners();
            this.updatePlatformSpecificMenu();
            this.setupIPC();
            await this.initAccountMenu();
            await this.loadSettings();
            if (typeof w.IntegratedTerminalPanel !== 'undefined') {
                const IntegratedTerminalPanelCtor = w.IntegratedTerminalPanel as new (...args: unknown[]) => unknown;
                this.terminalPanel = new IntegratedTerminalPanelCtor({
                    getApp: () => this
                });
                await (this.terminalPanel as Record<string, unknown>).init();
            }
            await this.restoreStartupWorkspaceIfNeeded();
            await this.restoreLastOpenTabs();
            this.setupTabStateSaver();
            this.configureAutoSave();
            this.loadDefaultFiles();
            this.updateStatusBar();
            this.setAppIcon();
            this.initialized = true;

            this.startLspIfNeeded();
            this._setupMarkerChangeListener();

            logInfo('OICPP App 初始化完成');
        } catch (error) {
            logError('OICPP App 初始化失败:', error);
        }
    }

    setupEventListeners() {
        window.addEventListener('resize', () => {
            this.handleResize();
        });

        document.addEventListener('keydown', (e: KeyboardEvent) => {
            this.handleKeyDown(e);
        }, true);

        document.addEventListener('dragover', (e: DragEvent) => {
            e.preventDefault();
        });

        document.addEventListener('drop', (e: DragEvent) => {
            e.preventDefault();
            this.handleFileDrop(e);
        });

        document.addEventListener('contextmenu', (e: MouseEvent) => {
            const target = e.target as HTMLElement | null;
            if (!target) return;

            const isInEditor = target.closest('.monaco-editor') ||
                target.closest('.monaco-editor-container') ||
                target.classList.contains('monaco-editor') ||
                target.classList.contains('monaco-editor-container');

            const isInCloudPanel = target.closest('#cloud-panel') || target.closest('.cloud-tree');
            if (isInCloudPanel) {
                return;
            }

            if (isInEditor) {
                return;
            }

            e.preventDefault();
            this.showContextMenu(e);
        });

        document.addEventListener('settings-changed', (e: CustomEvent) => {
            const detail = e.detail as Record<string, unknown> | undefined;
            this.applySettings(detail?.type, detail?.settings);
        });

        this.setupMenuBarEvents();
    }

    setupMenuBarEvents() {
        document.addEventListener('click', (e: MouseEvent) => {
            const target = e.target as HTMLElement | null;
            if (!target || (!target.classList.contains('menu-dropdown-item') && !target.closest('.menu-dropdown-item'))) {
                return;
            }

            const menuItem = target.classList.contains('menu-dropdown-item')
                ? target
                : target.closest('.menu-dropdown-item');
            if (!menuItem) {
                return;
            }

            if (menuItem.classList.contains('disabled') || menuItem.getAttribute('aria-disabled') === 'true') {
                e.preventDefault();
                const blockedAction = menuItem.dataset.action;
                if (blockedAction === 'check-update') {
                    if (this.updateDownloadState.pendingInstall) {
                        this.showMessage(window.i18n ? window.i18n.t('message.updatePendingInstall') : '已有更新等待安装，请先退出 OICPP 完成安装', 'info');
                        return;
                    }
                    if (this.updateDownloadState.autoChecking) {
                        this.showMessage(window.i18n ? window.i18n.t('message.updateAutoChecking') : '正在执行启动自动检查，请稍后再手动检查更新', 'info');
                    } else if (this.updateDownloadState.downloading) {
                        const versionSuffix = this.updateDownloadState.version ? ` (${this.updateDownloadState.version})` : '';
                        this.showMessage((window.i18n ? window.i18n.t('message.updateDownloading', { version: versionSuffix, progress: this.updateDownloadState.progress }) : `更新正在后台下载${versionSuffix}，当前进度 ${this.updateDownloadState.progress}%`), 'info');
                    }
                }
                return;
            }

            const action = menuItem.dataset.action;
            if (action) {
                this.handleMenuAction(action);
            }
        });

        document.addEventListener('mouseover', (e: MouseEvent) => {
            const target = e.target as HTMLElement | null;
            if (!target || !target.classList.contains('menu-item')) {
                return;
            }
            document.querySelectorAll('.menu-dropdown.active').forEach((menu) => {
                menu.classList.remove('active');
            });
            const dropdown = target.querySelector('.menu-dropdown');
            if (dropdown) {
                dropdown.classList.add('active');
            }
        });

        document.addEventListener('click', (e: MouseEvent) => {
            const target = e.target as HTMLElement | null;
            if (!target || !target.closest('.menu-bar')) {
                document.querySelectorAll('.menu-dropdown.active').forEach((menu) => {
                    menu.classList.remove('active');
                });
            }
        });
    }

    async handleMenuAction(action: string) {
        logInfo('菜单动作:', action);

        switch (action) {
            case 'new-file':
                this.createNewCppFile();
                break;
            case 'new-temp-file':
                await this.createNewTempFile();
                break;
            case 'open-file':
                this.openFile();
                break;
            case 'open-folder':
                this.openFolder();
                break;
            case 'save-file':
                this.saveFile();
                break;
            case 'save-as':
                this.saveFileAs();
                break;
            case 'compiler-settings':
                this.openCompilerSettings();
                break;
            case 'editor-settings':
                await this.openEditorSettings();
                break;
            case 'templates':
                this.openTemplateSettings();
                break;
            case 'template-settings':
                this.openTemplateSettings();
                break;
            case 'backup-settings':
                this.openBackupSettings();
                break;
            case 'debug':
                this.startDebug();
                break;
            case 'compile':
                this.compileCode();
                break;
            case 'run':
                this.runCode();
                break;
            case 'format-code':
                this.formatCode();
                break;
            case 'open-terminal':
                await this.openIntegratedTerminal();
                break;
            case 'cloud-compile':
                if (!this.ensureLocalFileForFeature(window.i18n ? window.i18n.t('message.cloudCompile') : '云端编译')) {
                    break;
                }
                if (this.compilerManager && typeof (this.compilerManager as Record<string, unknown>).cloudCompileCurrentFile === 'function') {
                    (this.compilerManager as Record<string, unknown>).cloudCompileCurrentFile();
                }
                break;
            case 'find-replace':
                this.showFindReplace();
                break;
            case 'compile-run':
                this.compileAndRun();
                break;
            case 'about':
                this.showAbout();
                break;
            case 'feedback':
                this.showFeedback();
                break;
            case 'upload-log':
                await this.uploadClientLogFromMenu();
                break;
            case 'check-update':
                this.checkForUpdates();
                break;
            case 'open-source-licenses':
                this.showOpenSourceLicenses();
                break;
            case 'open-file-history':
                this.openFileHistory();
                break;
            case 'open-browser':
                this.openBuiltinBrowser();
                break;
            case 'ide-login':
                await this.startIdeLogin();
                break;
            case 'ide-account':
                this.openIdeAccount();
                break;
            case 'ide-logout':
                await this.logoutIdeAccount();
                break;
            default:
                logInfo('未知的菜单动作:', action);
        }
    }

    async initAccountMenu() {
        await this.refreshAccountState();

        const w = window as unknown as { electronAPI?: unknown };
        if (!w.electronAPI || this._accountIpcBound) {
            return;
        }

        this._accountIpcBound = true;

        const electronAPI = w.electronAPI as Record<string, unknown>;
        if (typeof electronAPI.onIdeLoginUpdated === 'function') {
            (electronAPI.onIdeLoginUpdated as (cb: (payload: Record<string, unknown>) => void) => void)((payload) => {
                this.accountLoggedIn = !!payload?.loggedIn;
                this.accountInfo = payload?.user || null;
                this.updateAccountMenu();
                if (payload?.message) {
                    this.showMessage(String(payload.message), payload.loggedIn ? 'success' : 'info');
                }
            });
        }

        if (typeof electronAPI.onIdeLoginError === 'function') {
            (electronAPI.onIdeLoginError as (cb: (payload: Record<string, unknown>) => void) => void)((payload) => {
                const msg = String(payload?.message || (window.i18n ? window.i18n.t('message.loginFailed') : '登录失败'));
                this.showMessage(msg, 'error');
            });
        }
    }

    async refreshAccountState() {
        const w = window as unknown as { electronAPI?: unknown };
        if (!w.electronAPI || typeof (w.electronAPI as Record<string, unknown>).getIdeLoginStatus !== 'function') {
            this.updateAccountMenu();
            return;
        }
        try {
            const electronAPI = w.electronAPI as Record<string, unknown>;
            const status = await (electronAPI.getIdeLoginStatus as () => Promise<Record<string, unknown>>)();
            this.accountLoggedIn = !!status?.loggedIn;
            this.accountInfo = status?.user || null;
            logInfo('[Account] 获取登录状态:', {
                loggedIn: this.accountLoggedIn,
                user: this.accountInfo?.username || ''
            });
        } catch (error) {
            logWarn('获取登录状态失败:', error?.message || error);
        }
        this.updateAccountMenu();
    }

    updateAccountMenu() {
        const loginItem = document.querySelector('.menu-dropdown-item[data-action="ide-login"]') as HTMLElement | null;
        const accountItem = document.querySelector('.menu-dropdown-item[data-action="ide-account"]') as HTMLElement | null;
        const logoutItem = document.querySelector('.menu-dropdown-item[data-action="ide-logout"]') as HTMLElement | null;

        try {
            const w = window as unknown as { sidebarManager?: unknown };
            if (w.sidebarManager && typeof (w.sidebarManager as Record<string, unknown>).setCloudPanelVisible === 'function') {
                (w.sidebarManager as Record<string, unknown>).setCloudPanelVisible(this.accountLoggedIn);
            }
        } catch (error) {
            logWarn('更新云同步面板可见性失败:', error);
        }
        if (!loginItem || !accountItem || !logoutItem) return;

        const accountLabel = accountItem.querySelector('span') || accountItem;
        const username = this.accountInfo?.username || '';

        if (this.accountLoggedIn) {
            loginItem.style.display = 'none';
            accountItem.style.display = '';
            logoutItem.style.display = '';
            if (accountLabel) {
                accountLabel.textContent = username ? `我的账户(${username})` : '我的账户';
            }
        } else {
            loginItem.style.display = '';
            accountItem.style.display = 'none';
            logoutItem.style.display = 'none';
            if (accountLabel) {
                accountLabel.textContent = '我的账户';
            }
        }
    }

    async startIdeLogin() {
        const w = window as unknown as { electronAPI?: unknown };
        if (!w.electronAPI || typeof (w.electronAPI as Record<string, unknown>).startIdeLogin !== 'function') {
            this.showMessage(this.t('message.loginUnavailable', null, 'Login is unavailable'), 'error');
            return;
        }
        try {
            const electronAPI = w.electronAPI as Record<string, unknown>;
            const result = await (electronAPI.startIdeLogin as () => Promise<Record<string, unknown>>)();
            if (result && result.ok === false && result.message) {
                this.showMessage(String(result.message), 'warning');
            } else {
                this.showMessage(this.t('message.browserOpenedForLogin', null, 'Browser opened. Please complete sign-in.'), 'info');
            }
        } catch (error) {
            this.showMessage(this.t('message.loginStartFailed', { error: error?.message || error }, `Failed to start login: ${error?.message || error}`), 'error');
        }
    }

    openIdeAccount() {
        if (!this.accountLoggedIn) {
            this.showMessage(this.t('message.loginRequired', null, 'Please log in first'), 'warning');
            return;
        }
        const w = window as unknown as { electronAPI?: unknown };
        if (w.electronAPI && typeof (w.electronAPI as Record<string, unknown>).openExternal === 'function') {
            const electronAPI = w.electronAPI as Record<string, unknown>;
            (electronAPI.openExternal as (url: string) => void)('https://auth.mywwzh.top/account');
        }
    }

    async logoutIdeAccount() {
        const w = window as unknown as { electronAPI?: unknown };
        if (!w.electronAPI || typeof (w.electronAPI as Record<string, unknown>).logoutIdeAccount !== 'function') {
            this.showMessage(this.t('message.logoutUnavailable', null, 'Logout is unavailable'), 'error');
            return;
        }
        try {
            const electronAPI = w.electronAPI as Record<string, unknown>;
            const result = await (electronAPI.logoutIdeAccount as () => Promise<Record<string, unknown>>)();
            if (result && result.ok) {
                this.showMessage(this.t('message.logoutSuccess', null, 'Logged out'), 'success');
            }
        } catch (error) {
            this.showMessage(this.t('message.logoutFailed', { error: error?.message || error }, `Failed to log out: ${error?.message || error}`), 'error');
        } finally {
            const electronAPI = w.electronAPI as Record<string, unknown>;
            if (electronAPI && typeof electronAPI.openExternal === 'function') {
                try { (electronAPI.openExternal as (url: string) => void)('https://auth.mywwzh.top/logout'); } catch (_) { }
            }
        }
    }

    updatePlatformSpecificMenu() {
        try {
            const isWindows = !!(window.process && window.process.platform === 'win32');
            const cloudMenuItem = document.querySelector('.menu-dropdown-item[data-action="cloud-compile"]') as HTMLElement | null;
            if (cloudMenuItem) {
                cloudMenuItem.style.display = isWindows ? '' : 'none';
                if (!isWindows) {
                    cloudMenuItem.setAttribute('title', '云编译目前仅在 Windows 版本提供');
                }
            }
        } catch (_) { }
    }

    updateCheckUpdateMenuItem(state = this.updateDownloadState) {
        const menuItem = document.querySelector('.menu-dropdown-item[data-action="check-update"]') as HTMLElement | null;
        if (!menuItem) return;

        const pendingInstall = (state as Record<string, unknown>).pendingInstall;
        const autoChecking = (state as Record<string, unknown>).autoChecking;
        const downloading = (state as Record<string, unknown>).downloading;

        if (pendingInstall) {
            menuItem.classList.add('disabled');
            menuItem.setAttribute('aria-disabled', 'true');
        } else {
            menuItem.classList.remove('disabled');
            menuItem.removeAttribute('aria-disabled');
        }

        if (autoChecking || downloading || pendingInstall) {
            const versionSuffix = (state as Record<string, unknown>).version ? ` (${(state as Record<string, unknown>).version})` : '';
            const progress = (state as Record<string, unknown>).progress;
            menuItem.title = window.i18n ? window.i18n.t('message.updateDownloading', { version: versionSuffix, progress }) : `更新正在后台下载${versionSuffix}，当前进度 ${progress}%`;
        }
    }

    applyUpdateDownloadStatus(payload = {}) {
        const s = payload as Record<string, unknown>;
        this.updateDownloadState.autoChecking = s.autoChecking === true;
        this.updateDownloadState.downloading = s.downloading === true;
        this.updateDownloadState.version = typeof s.version === 'string' ? s.version : '';
        this.updateDownloadState.progress = typeof s.progress === 'number' ? s.progress : 0;
        this.updateDownloadState.pendingInstall = s.pendingInstall === true;
        this.updateDownloadState.pendingVersion = typeof s.pendingVersion === 'string' ? s.pendingVersion : '';
        this.updateCheckUpdateMenuItem();
    }

    setupIPC() {
        const w = window as unknown as { electronAPI?: unknown };
        if (!w.electronAPI) return;

        const electronAPI = w.electronAPI as Record<string, unknown>;
        if (typeof electronAPI.onMenuNewTempFile === 'function') {
            (electronAPI.onMenuNewTempFile as (cb: () => void) => void)(() => this.createNewTempFile());
        }
        if (typeof electronAPI.onMenuOpenTerminal === 'function') {
            (electronAPI.onMenuOpenTerminal as (cb: () => void) => void)(() => this.openIntegratedTerminal());
        }
        if (typeof electronAPI.onMenuOpenFileHistory === 'function') {
            (electronAPI.onMenuOpenFileHistory as (cb: () => void) => void)(() => this.openFileHistory());
        }
        if (typeof electronAPI.onMenuOpenBrowser === 'function') {
            (electronAPI.onMenuOpenBrowser as (cb: () => void) => void)(() => this.openBuiltinBrowser());
        }
        if (typeof electronAPI.onMenuNewBrowserTab === 'function') {
            (electronAPI.onMenuNewBrowserTab as (cb: () => void) => void)(() => this.openBuiltinBrowser());
        }
        if (electronAPI.onThemeChanged) {
            (electronAPI.onThemeChanged as (theme: unknown) => void)((theme) => {
                document.documentElement.setAttribute('data-theme', String(theme));
            });
        }
        if (typeof electronAPI.onUpdateDownloadStatus === 'function') {
            (electronAPI.onUpdateDownloadStatus as (cb: (payload: Record<string, unknown>) => void) => void)((payload) => {
                this.applyUpdateDownloadStatus(payload);
            });
        }
        if (typeof electronAPI.getUpdateDownloadStatus === 'function') {
            (electronAPI.getUpdateDownloadStatus as () => Promise<Record<string, unknown>>)().then((status) => {
                this.applyUpdateDownloadStatus(status);
            }).catch((err) => logWarn('获取下载状态失败:', err));
        }
        if (typeof electronAPI.onAppToast === 'function') {
            (electronAPI.onAppToast as (cb: (payload: Record<string, unknown>) => void) => void)((payload) => {
                if (!payload || typeof payload.message !== 'string') return;
                this.showMessage(payload.message, typeof payload.type === 'string' ? payload.type : undefined);
            });
        }
    }

    async restoreStartupWorkspaceIfNeeded() {
        const w = window as unknown as { electronAPI?: unknown };
        if (!w.electronAPI || typeof (w.electronAPI as Record<string, unknown>).consumeStartupWorkspaceToOpen !== 'function') {
            return;
        }
        try {
            const electronAPI = w.electronAPI as Record<string, unknown>;
            const folderPath = await (electronAPI.consumeStartupWorkspaceToOpen as () => Promise<string | null>)();
            if (!folderPath || typeof folderPath !== 'string') {
                return;
            }
            this.openFolder(folderPath);
        } catch (_) { }
    }

    async loadSettings() {
        const w = window as unknown as { electronAPI?: unknown };
        if (!w.electronAPI || !(w.electronAPI as Record<string, unknown>).getAllSettings) {
            return;
        }
        try {
            const electronAPI = w.electronAPI as Record<string, unknown>;
            const allSettings = await (electronAPI.getAllSettings as () => Promise<Record<string, unknown>>)();
            if (allSettings) {
                this.settings = { ...this.settings, ...allSettings };
                if (this.compilerManager) {
                    const cm = this.compilerManager as Record<string, unknown>;
                    if (typeof cm.loadSettings === 'function') {
                        cm.loadSettings(this.settings);
                    }
                }
            }
        } catch (_) { }
    }

    applySettings(settingsType = null, newSettings = null) {
        if (newSettings) {
            this.settings = { ...this.settings, ...newSettings };
        }
    }

    handleResize() {
        // 窗口大小调整处理
    }

    handleKeyDown(event: KeyboardEvent) {
        // 键盘事件处理
    }

    handleFileDrop(event: DragEvent) {
        // 文件拖放处理
    }

    showContextMenu(event: MouseEvent) {
        // 右键菜单处理
    }

    createNewCppFile() {
        // 新建 C++ 文件
    }

    async createNewTempFile() {
        // 新建临时文件
    }

    openFile() {
        // 打开文件
    }

    openFolder(folderPath?: string) {
        // 打开文件夹
    }

    saveFile() {
        // 保存文件
    }

    saveFileAs() {
        // 另存为
    }

    openCompilerSettings() {
        // 打开编译器设置
    }

    async openEditorSettings() {
        // 打开编辑器设置
    }

    openTemplateSettings() {
        // 打开模板设置
    }

    openBackupSettings() {
        // 打开备份设置
    }

    startDebug() {
        // 开始调试
    }

    compileCode() {
        // 编译代码
    }

    runCode() {
        // 运行代码
    }

    openIntegratedTerminal() {
        // 打开集成终端
    }

    ensureLocalFileForFeature(featureName: string): boolean {
        // 确保本地文件
        return true;
    }

    showAbout() {
        // 显示关于
    }

    showFeedback() {
        // 显示反馈
    }

    async uploadClientLogFromMenu() {
        // 上传日志
    }

    checkForUpdates() {
        // 检查更新
    }

    showOpenSourceLicenses() {
        // 显示开源许可证
    }

    openFileHistory() {
        // 打开文件历史
    }

    openBuiltinBrowser() {
        // 打开内置浏览器
    }

    compileAndRun() {
        // 编译并运行
    }

    runAllSamples() {
        // 运行所有样例
    }

    setupTabStateSaver() {
        // 设置标签状态保存
    }

    configureAutoSave() {
        // 配置自动保存
    }

    loadDefaultFiles() {
        // 加载默认文件
    }

    updateStatusBar() {
        // 更新状态栏
    }

    setAppIcon() {
        // 设置应用图标
    }

    startLspIfNeeded() {
        // 启动 LSP
    }

    _setupMarkerChangeListener() {
        // 设置标记变化监听
    }

    onFileSaved(filePath: string) {
        // 文件保存回调
    }

    updateLspStatusBar() {
        // 更新 LSP 状态栏
    }

    updateMarkerStatusBar() {
        // 更新标记状态栏
    }

    onFolderOpened(folderPath: string) {
        // 文件夹打开回调
    }

    formatCode() {
        // 格式化代码
    }

    showFindReplace() {
        // 显示查找替换
    }

    debounce(fn: Function, delay: number) {
        // 防抖
    }

    formatHistoryTime(date: Date) {
        // 格式化历史时间
    }

    async saveCurrentOpenTabs() {
        // 保存当前打开的标签页
    }

    async restoreLastOpenTabs() {
        // 恢复上次打开的标签页
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
