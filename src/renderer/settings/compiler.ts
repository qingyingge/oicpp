export {};

class CompilerSettings {
    settings: Record<string, unknown> = {
        compilerPath: '',
        pythonInterpreterPath: '',
        compilerArgs: '-std=c++14 -O2 -static',
        runMode: 'popup'
    };
    isMacPlatform = false;
    isIntegratedOnlyPlatform = false;

    constructor() {
        this.init();
    }

    setupSidebarNavigation() {
        const sidebarItems = document.querySelectorAll<HTMLElement>('.sidebar-item');
        const sections = document.querySelectorAll<HTMLElement>('.settings-section');

        sidebarItems.forEach((item) => {
            item.addEventListener('click', () => {
                sidebarItems.forEach((i) => i.classList.remove('active'));
                item.classList.add('active');

                sections.forEach((section) => section.classList.remove('active'));

                const targetId = item.getAttribute('data-target');
                const targetSection = targetId ? document.getElementById(targetId) : null;
                if (targetSection) {
                    targetSection.classList.add('active');
                }
            });
        });
    }

    async init() {
        const urlParams = new URLSearchParams(window.location.search);
        const themeFromUrl = urlParams.get('theme');
        if (themeFromUrl) {
            this.applyTheme(themeFromUrl);
        }
        await this.loadSettings();
        this.isMacPlatform = await this.detectMacPlatform();
        this.isIntegratedOnlyPlatform = await this.detectIntegratedOnlyPlatform();
        if (this.isIntegratedOnlyPlatform) {
            this.settings.runMode = 'integrated-terminal';
        }
        this.setupEventListeners();
        this.setupThemeListener();
        await this.applyCurrentTheme();
        this.updateUI();
        this.detectExistingCompiler();
    }

    setupThemeListener() {
        if (window.electronIPC && window.electronIPC.on) {
            window.electronIPC.on('theme-changed', (_event, theme: string) => {
                logInfo('编译器设置页面收到主题变更:', theme);
                this.applyTheme(theme);
            });
        }
    }

    async applyCurrentTheme() {
        try {
            if (window.electronAPI && window.electronAPI.getAllSettings) {
                const settings = await window.electronAPI.getAllSettings();
                if (settings && typeof settings === 'object' && 'theme' in settings) {
                    const theme = settings.theme as string | undefined;
                    if (theme) {
                        this.applyTheme(theme);
                    }
                }
            }
        } catch (error) {
            logError('获取主题设置失败:', error);
        }
    }

    applyTheme(theme: string) {
        logInfo('应用主题到编译器设置页面:', theme);
        document.body.setAttribute('data-theme', theme);
        document.documentElement.setAttribute('data-theme', theme);
    }

    setupEventListeners() {
        logInfo('[编译器设置] 开始设置事件监听器');

        this.setupSidebarNavigation();

        const browseBtn = document.getElementById('browse-compiler');
        if (browseBtn) {
            logInfo('[编译器设置] 浏览编译器按钮事件已绑定');
            browseBtn.addEventListener('click', (e) => {
                logInfo('[编译器设置] 浏览编译器按钮被点击');
                e.preventDefault();
                this.browseCompiler();
            });
        } else {
            logError('[编译器设置] 未找到浏览编译器按钮');
        }

        const browsePythonBtn = document.getElementById('browse-python-interpreter');
        if (browsePythonBtn) {
            browsePythonBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.browsePythonInterpreter();
            });
        }

        const browseTestlibBtn = document.getElementById('browse-testlib');
        if (browseTestlibBtn) {
            browseTestlibBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.browseTestlib();
            });
        }

        const installBtn = document.getElementById('install-compiler');
        if (installBtn) {
            this.getCurrentPlatform().then((p) => {
                const platform = String(p);
                if (platform !== 'windows') {
                    const btn = installBtn as HTMLButtonElement;
                    btn.disabled = true;
                    btn.title = window.i18n
                        ? window.i18n.t('compiler.nonWindowsHint')
                        : '非 Windows 平台请使用系统自带/自行安装的编译器';
                    btn.textContent = window.i18n
                        ? window.i18n.t('compiler.downloadDisabled')
                        : '下载已禁用 (请使用系统编译器)';
                } else {
                    logInfo('[编译器设置] 安装编译器按钮事件已绑定');
                    installBtn.addEventListener('click', (e) => {
                        logInfo('[编译器设置] 安装编译器按钮被点击');
                        e.preventDefault();
                        this.showInstallDialog();
                    });
                }
            });
        }

        const installTestlibBtn = document.getElementById('install-testlib');
        if (installTestlibBtn) {
            installTestlibBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.showTestlibInstallDialog();
            });
        }

        const closeBtn = document.getElementById('close-install-dialog');
        if (closeBtn) {
            logInfo('[编译器设置] 关闭安装对话框按钮事件已绑定');
            closeBtn.addEventListener('click', (e) => {
                logInfo('[编译器设置] 关闭安装对话框按钮被点击');
                e.preventDefault();
                this.closeInstallDialog();
            });
        }

        const closeTestlibBtn = document.getElementById('close-testlib-install-dialog');
        if (closeTestlibBtn) {
            closeTestlibBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.closeTestlibInstallDialog();
            });
        }

        const installDialog = document.getElementById('install-dialog');
        if (installDialog) {
            installDialog.addEventListener('click', (e) => {
                if (e.target === installDialog) {
                    logInfo('[编译器设置] 点击对话框背景关闭');
                    this.closeInstallDialog();
                }
            });
        }

        const saveBtn = document.getElementById('save-settings');
        if (saveBtn) {
            logInfo('[编译器设置] 保存设置按钮事件已绑定');
            saveBtn.addEventListener('click', (e) => {
                logInfo('[编译器设置] 保存设置按钮被点击');
                e.preventDefault();
                this.saveSettings();
            });
        } else {
            logError('[编译器设置] 未找到保存设置按钮');
        }

        const cancelBtn = document.getElementById('cancel-settings');
        if (cancelBtn) {
            logInfo('[编译器设置] 取消按钮事件已绑定');
            cancelBtn.addEventListener('click', (e) => {
                logInfo('[编译器设置] 取消按钮被点击');
                e.preventDefault();
                this.closeWindow();
            });
        } else {
            logError('[编译器设置] 未找到取消按钮');
        }

        const resetBtn = document.getElementById('reset-settings');
        if (resetBtn) {
            logInfo('[编译器设置] 重置按钮事件已绑定');
            resetBtn.addEventListener('click', (e) => {
                logInfo('[编译器设置] 重置按钮被点击');
                e.preventDefault();
                this.resetSettings();
            });
        }

        const browseTestlibSettingsBtn = document.getElementById('browse-testlib-settings');
        if (browseTestlibSettingsBtn) {
            browseTestlibSettingsBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.browseTestlib();
            });
        }
    }

    async loadSettings() {
        try {
            if (window.electronAPI && window.electronAPI.getAllSettings) {
                const saved = await window.electronAPI.getAllSettings();
                if (saved && typeof saved === 'object') {
                    this.settings = {
                        compilerPath: saved.compilerPath || '',
                        pythonInterpreterPath: saved.pythonInterpreterPath || '',
                        compilerArgs: saved.compilerArgs || '-std=c++14 -O2 -static',
                        runMode: saved.runMode || 'popup'
                    };
                }
            }
        } catch (error) {
            logError('加载编译器设置失败:', error);
        }
    }

    updateUI() {
        const compilerPathInput = document.getElementById('compiler-path') as HTMLInputElement | null;
        if (compilerPathInput) {
            compilerPathInput.value = String(this.settings.compilerPath || '');
        }
        const pythonInterpreterPathInput = document.getElementById(
            'python-interpreter-path'
        ) as HTMLInputElement | null;
        if (pythonInterpreterPathInput) {
            pythonInterpreterPathInput.value = String(this.settings.pythonInterpreterPath || '');
        }
        const compilerArgsInput = document.getElementById(
            'compiler-args'
        ) as HTMLInputElement | null;
        if (compilerArgsInput) {
            compilerArgsInput.value = String(this.settings.compilerArgs || '');
        }
        const runModeSelect = document.getElementById('run-mode') as HTMLSelectElement | null;
        if (runModeSelect) {
            runModeSelect.value = String(this.settings.runMode || 'popup');
        }
    }

    async browsePythonInterpreter() {
        const result = await this.openPathDialog('选择 Python 解释器');
        if (result) {
            this.settings.pythonInterpreterPath = result;
            const input = document.getElementById(
                'python-interpreter-path'
            ) as HTMLInputElement | null;
            if (input) {
                input.value = result;
            }
        }
    }

    async browseCompiler() {
        const result = await this.openPathDialog('选择编译器');
        if (result) {
            this.settings.compilerPath = result;
            const input = document.getElementById('compiler-path') as HTMLInputElement | null;
            if (input) {
                input.value = result;
            }
        }
    }

    async browseTestlib() {
        const result = await this.openPathDialog('选择 Testlib');
        if (result) {
            const input = document.getElementById('testlib-path') as HTMLInputElement | null;
            if (input) {
                input.value = result;
            }
        }
    }

    private async openPathDialog(title: string): Promise<string | null> {
        if (window.electronAPI && window.electronAPI.send) {
            // Use a simple approach - return null for now, the dialog will be handled by main process
            return null;
        }
        return null;
    }

    showInstallDialog() {
        const dialog = document.getElementById('install-dialog');
        if (dialog) {
            dialog.style.display = 'block';
        }
    }

    closeInstallDialog() {
        const dialog = document.getElementById('install-dialog');
        if (dialog) {
            dialog.style.display = 'none';
        }
    }

    async loadAvailableCompilers() {
        try {
            if (window.electronAPI && window.electronAPI.walkDirectory) {
                const result = await window.electronAPI.walkDirectory(
                    '/usr/bin',
                    { excludeGlobs: [] }
                );
                return result;
            }
        } catch (error) {
            logError('加载编译器列表失败:', error);
        }
        return { success: false, files: [] };
    }

    saveSettings() {
        if (window.electronAPI && window.electronAPI.updateSettings) {
            const compilerSettings: Record<string, unknown> = {
                compilerPath: this.settings.compilerPath,
                pythonInterpreterPath: this.settings.pythonInterpreterPath,
                compilerArgs: this.settings.compilerArgs,
                runMode: this.settings.runMode
            };
            window.electronAPI.updateSettings(compilerSettings).catch((err) => {
                logError('保存编译器设置失败:', err);
            });
        }
    }

    resetSettings() {
        this.settings = {
            compilerPath: '',
            pythonInterpreterPath: '',
            compilerArgs: '-std=c++14 -O2 -static',
            runMode: 'popup'
        };
        this.updateUI();
    }

    detectExistingCompiler() {
        // 检测系统中已安装的编译器
    }

    getCurrentPlatform() {
        return Promise.resolve(process.platform);
    }

    detectMacPlatform() {
        return Promise.resolve(process.platform === 'darwin');
    }

    detectIntegratedOnlyPlatform() {
        return Promise.resolve(false);
    }

    getDownloadedVersions() {
        return Promise.resolve<string[]>([]);
    }

    isCompilerSelected(path: string) {
        return String(this.settings.compilerPath) === path;
    }

    escapeHtml(text: string) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    escapeAttribute(text: string) {
        return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    addCompilerItemListeners(item: HTMLElement, compiler: Record<string, unknown>) {
        const downloadBtn = item.querySelector('.download-btn');
        if (downloadBtn) {
            const btn = downloadBtn as HTMLButtonElement;
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.downloadCompiler(compiler);
            });
        }

        const selectBtn = item.querySelector('.select-btn');
        if (selectBtn) {
            const btn = selectBtn as HTMLButtonElement;
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const version = btn.getAttribute('data-version');
                if (version) {
                    this.selectCompiler(version);
                }
            });
        }
    }

    async downloadCompiler(compiler: Record<string, unknown>) {
        const downloadBtn = document.querySelector(
            `button.download-btn[data-version="${String(compiler.version || '')}"]`
        ) as HTMLButtonElement | null;
        if (!downloadBtn) return;

        try {
            downloadBtn.disabled = true;
            downloadBtn.textContent = '下载中...';

            this.showMessage(
                `开始下载 ${String(compiler.name || '')} ${String(compiler.version || '')}...`,
                'info'
            );

            if (window.electronAPI && window.electronAPI.downloadCompiler) {
                const fullUrl = String(compiler.downloadUrl || '').startsWith('http')
                    ? String(compiler.downloadUrl)
                    : `https://oicppide.com${String(compiler.downloadUrl)}`;

                const result = await window.electronAPI.downloadCompiler({
                    url: fullUrl,
                    version: String(compiler.version || ''),
                    name: String(compiler.name || '')
                });

                if (result.success) {
                    this.showMessage(
                        `${String(compiler.name || '')} ${String(compiler.version || '')} 下载并安装成功！`,
                        'success'
                    );

                    downloadBtn.textContent = '已下载';
                    downloadBtn.disabled = false;
                    downloadBtn.classList.remove('download-btn');
                    downloadBtn.classList.add('downloaded-btn');

                    if (result.compilerPath) {
                        await this.setCompilerPath(String(result.compilerPath));
                        await this.selectCompiler(String(compiler.version || ''));
                    }
                } else {
                    throw new Error(String(result.error || '下载失败'));
                }
            } else {
                throw new Error('下载 API 不可用');
            }
        } catch (error) {
            logError('下载编译器失败:', error);
            this.showMessage(`下载失败: ${error?.message || String(error)}`, 'error');

            if (downloadBtn) {
                downloadBtn.disabled = false;
                downloadBtn.textContent = '下载';
            }
        }
    }

    async selectCompiler(version: string) {
        try {
            if (window.electronAPI && window.electronAPI.selectCompiler) {
                const result = await window.electronAPI.selectCompiler(version);

                if (result.success) {
                    this.showMessage(`已选择编译器 ${version}`, 'success');

                    if (result.compilerPath) {
                        await this.setCompilerPath(String(result.compilerPath));
                    }

                    const compilerItems = document.querySelectorAll<HTMLElement>(
                        '.compiler-item'
                    );
                    compilerItems.forEach((item) => {
                        const selectBtn = item.querySelector('.select-btn');
                        if (selectBtn) {
                            const btn = selectBtn as HTMLButtonElement;
                            const itemVersion = btn.getAttribute('data-version');
                            if (itemVersion === version) {
                                item.classList.add('selected');
                                const actionsDiv = item.querySelector('.compiler-actions');
                                if (actionsDiv) {
                                    actionsDiv.innerHTML = `
                                    <span class="status selected-status">已选中</span>
                                    <span class="status downloaded-status">已下载</span>
                                `;
                                }
                            } else {
                                item.classList.remove('selected');
                                if (item.classList.contains('downloaded')) {
                                    const actionsDiv = item.querySelector('.compiler-actions');
                                    if (actionsDiv) {
                                        actionsDiv.innerHTML = `
                                        <button class="select-btn" data-version="${itemVersion}">选择</button>
                                        <span class="status downloaded-status">已下载</span>
                                    `;
                                        const newSelectBtn = actionsDiv.querySelector('.select-btn');
                                        if (newSelectBtn) {
                                            newSelectBtn.addEventListener('click', (e) => {
                                                e.preventDefault();
                                                this.selectCompiler(itemVersion || '');
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    });
                } else {
                    throw new Error(String(result.error || '选择失败'));
                }
            }
        } catch (error) {
            logError('选择编译器失败:', error);
            this.showMessage(`选择失败: ${error?.message || String(error)}`, 'error');
        }
    }

    async setCompilerPath(path: string) {
        const input = document.getElementById('compiler-path') as HTMLInputElement | null;
        if (input) {
            input.value = path;
        }

        if (window.electronAPI && window.electronAPI.saveSetting) {
            await window.electronAPI.saveSetting('compilerPath', path);
        }
    }

    async getDownloadedCompilers() {
        try {
            if (window.electronAPI && window.electronAPI.getDownloadedCompilers) {
                return await window.electronAPI.getDownloadedCompilers();
            }
        } catch (error) {
            logError('获取已下载编译器失败:', error);
        }
        return [];
    }

    async isCompilerSelectedAsync(path: string) {
        try {
            if (window.electronAPI && window.electronAPI.isCompilerSelected) {
                return await window.electronAPI.isCompilerSelected(path);
            }
        } catch (error) {
            logError('检查编译器选择状态失败:', error);
        }
        return false;
    }

    showMessage(message: string, type?: string) {
        logInfo(`[编译器设置][${type || 'info'}] ${message}`);
    }

    async showConfirmDialog(title: string, msg: string) {
        if (window.dialogManager && window.dialogManager.showConfirmDialog) {
            return window.dialogManager.showConfirmDialog(title, msg);
        }
        return Promise.resolve(false);
    }

    refreshCompilerItemState() {
        // 刷新编译器项状态
    }

    async testTestlib(testlibPath: string) {
        try {
            if (window.electronAPI && window.electronAPI.runCommandVersionProbe) {
                // 测试 testlib 路径
            }
        } catch (error) {
            logError('测试 Testlib 失败:', error);
        }
    }

    showTestlibInstallDialog() {
        const dialog = document.getElementById('testlib-install-dialog');
        if (dialog) {
            dialog.style.display = 'block';
        }
    }

    closeTestlibInstallDialog() {
        const dialog = document.getElementById('testlib-install-dialog');
        if (dialog) {
            dialog.style.display = 'none';
        }
    }

    async loadAvailableTestlibs() {
        try {
            if (window.electronAPI && window.electronAPI.walkDirectory) {
                const result = await window.electronAPI.walkDirectory(
                    '/usr/bin',
                    { excludeGlobs: [] }
                );
                return result;
            }
        } catch (error) {
            logError('加载 Testlib 列表失败:', error);
        }
        return { success: false, files: [] };
    }

    addTestlibItemListeners(testlibDiv: HTMLElement, testlib: Record<string, unknown>) {
        const downloadBtn = testlibDiv.querySelector('.download-btn');
        if (downloadBtn) {
            const btn = downloadBtn as HTMLButtonElement;
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.downloadTestlib(testlib);
            });
        }

        const selectBtn = testlibDiv.querySelector('.select-btn');
        if (selectBtn) {
            const btn = selectBtn as HTMLButtonElement;
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const version = btn.getAttribute('data-version');
                if (version) {
                    this.selectTestlib(version);
                }
            });
        }
    }

    async downloadTestlib(testlib: Record<string, unknown>) {
        const downloadBtn = document.querySelector(
            `button.download-btn[data-version="${String(testlib.version || '')}"]`
        ) as HTMLButtonElement | null;
        if (!downloadBtn) return;

        try {
            downloadBtn.disabled = true;
            downloadBtn.textContent = '下载中...';

            this.showMessage(
                `开始下载 ${String(testlib.name || '')} ${String(testlib.version || '')}...`,
                'info'
            );

            if (window.electronAPI && window.electronAPI.downloadTestlib) {
                const fullUrl = String(testlib.downloadUrl || '').startsWith('http')
                    ? String(testlib.downloadUrl)
                    : `https://oicppide.com${String(testlib.downloadUrl)}`;

                const result = await window.electronAPI.downloadTestlib({
                    url: fullUrl,
                    version: String(testlib.version || ''),
                    name: String(testlib.name || '')
                });

                if (result.success) {
                    this.showMessage(
                        `${String(testlib.name || '')} ${String(testlib.version || '')} 下载并安装成功！`,
                        'success'
                    );

                    downloadBtn.textContent = '已下载';
                    downloadBtn.disabled = false;
                    downloadBtn.classList.remove('download-btn');
                    downloadBtn.classList.add('downloaded-btn');

                    if (result.testlibPath) {
                        await this.setTestlibPath(String(result.testlibPath));
                        await this.selectTestlib(String(testlib.version || ''));
                    }
                } else {
                    throw new Error(String(result.error || '下载失败'));
                }
            } else {
                throw new Error('下载 API 不可用');
            }
        } catch (error) {
            logError('下载 Testlib 失败:', error);
            this.showMessage(`下载失败: ${error?.message || String(error)}`, 'error');

            if (downloadBtn) {
                downloadBtn.disabled = false;
                downloadBtn.textContent = '下载';
            }
        }
    }

    async selectTestlib(version: string) {
        try {
            if (window.electronAPI && window.electronAPI.selectTestlib) {
                const result = await window.electronAPI.selectTestlib(version);

                if (result.success) {
                    this.showMessage(`已选择 Testlib ${version}`, 'success');

                    if (result.testlibPath) {
                        await this.setTestlibPath(String(result.testlibPath));
                    }

                    const testlibItems = document.querySelectorAll<HTMLElement>(
                        '.compiler-item'
                    );
                    testlibItems.forEach((item) => {
                        const selectBtn = item.querySelector('.select-btn');
                        if (selectBtn) {
                            const btn = selectBtn as HTMLButtonElement;
                            const itemVersion = btn.getAttribute('data-version');
                            if (itemVersion === version) {
                                item.classList.add('selected');
                                const actionsDiv = item.querySelector('.compiler-actions');
                                if (actionsDiv) {
                                    actionsDiv.innerHTML = `
                                    <span class="status selected-status">已选中</span>
                                    <span class="status downloaded-status">已下载</span>
                                `;
                                }
                            } else {
                                item.classList.remove('selected');
                                if (item.classList.contains('downloaded')) {
                                    const actionsDiv = item.querySelector('.compiler-actions');
                                    if (actionsDiv) {
                                        actionsDiv.innerHTML = `
                                        <button class="select-btn" data-version="${itemVersion}">选择</button>
                                        <span class="status downloaded-status">已下载</span>
                                    `;
                                        const newSelectBtn = actionsDiv.querySelector('.select-btn');
                                        if (newSelectBtn) {
                                            newSelectBtn.addEventListener('click', (e) => {
                                                e.preventDefault();
                                                this.selectTestlib(itemVersion || '');
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    });
                } else {
                    throw new Error(String(result.error || '选择失败'));
                }
            }
        } catch (error) {
            logError('选择 Testlib 失败:', error);
            this.showMessage(`选择失败: ${error?.message || String(error)}`, 'error');
        }
    }

    async setTestlibPath(path: string) {
        const input = document.getElementById('testlib-path') as HTMLInputElement | null;
        if (input) {
            input.value = path;
        }

        if (window.electronAPI && window.electronAPI.saveSetting) {
            await window.electronAPI.saveSetting('testlibPath', path);
        }
    }

    async getDownloadedTestlibs() {
        try {
            if (window.electronAPI && window.electronAPI.getDownloadedTestlibs) {
                return await window.electronAPI.getDownloadedTestlibs();
            }
        } catch (error) {
            logError('获取已下载 Testlib 失败:', error);
        }
        return [];
    }

    async isTestlibSelected(version: string) {
        try {
            if (window.electronAPI && window.electronAPI.isTestlibSelected) {
                return await window.electronAPI.isTestlibSelected(version);
            }
        } catch (error) {
            logError('检查 Testlib 选择状态失败:', error);
        }
        return false;
    }

    closeWindow() {
        window.close();
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new CompilerSettings();
});
