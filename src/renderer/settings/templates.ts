export {};

declare const logInfo: (...args: unknown[]) => void;
declare const logWarn: (...args: unknown[]) => void;
declare const logError: (...args: unknown[]) => void;

interface SnippetItem {
    keyword: string;
    description: string;
    content: string;
}

interface TemplatesSettingsState {
    cppTemplate: string;
}

class TemplatesSettings {
    settings: TemplatesSettingsState = {
        cppTemplate: ''
    };
    snippets: SnippetItem[] = [];

    constructor() {
        this.init();
    }

    async init() {
        logInfo('初始化模板设置页面');
        const urlParams = new URLSearchParams(window.location.search);
        const themeFromUrl = urlParams.get('theme');
        if (themeFromUrl) {
            this.applyTheme(themeFromUrl);
        }
        await this.loadSettings();
        this.setupEventListeners();
        this.setupSidebarNavigation();
        this.setupThemeListener();
        await this.applyCurrentTheme();
        this.updateUI();
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

    setupThemeListener() {
        if (window.electronIPC && window.electronIPC.on) {
            window.electronIPC.on('theme-changed', (_event: unknown, theme: string) => {
                logInfo('代码模板设置页面收到主题变更:', theme);
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
        logInfo('应用主题到代码模板设置页面:', theme);
        document.body.setAttribute('data-theme', theme);
        document.documentElement.setAttribute('data-theme', theme);
    }

    setupEventListeners() {
        logInfo('设置事件监听器');
        const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || '');
        const modKey = (e: KeyboardEvent) => (isMac ? e.metaKey : e.ctrlKey);

        const saveBtn = document.getElementById('save-settings');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                this.saveSettings();
            });
        }

        const cancelBtn = document.getElementById('cancel-settings');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                this.closeWindow();
            });
        }

        const resetBtn = document.getElementById('reset-settings');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this.resetSettings();
            });
        }

        const previewBtn = document.getElementById('preview-template');
        if (previewBtn) {
            previewBtn.addEventListener('click', () => {
                this.showPreview();
            });
        }

        // 打开片段添加弹窗
        const addBtn = document.getElementById('add-snippet');
        if (addBtn) {
            addBtn.addEventListener('click', () => this.openSnippetDialog(-1));
        }

        // 关闭片段弹窗
        const closeSnippetDialogBtn = document.getElementById('close-snippet-dialog');
        if (closeSnippetDialogBtn) {
            closeSnippetDialogBtn.addEventListener('click', () => {
                this.closeSnippetDialog();
            });
        }

        const cancelSnippetBtn = document.getElementById('cancel-snippet-btn');
        if (cancelSnippetBtn) {
            cancelSnippetBtn.addEventListener('click', () => {
                this.closeSnippetDialog();
            });
        }

        const confirmSnippetBtn = document.getElementById('confirm-snippet-btn');
        if (confirmSnippetBtn) {
            confirmSnippetBtn.addEventListener('click', () => {
                this.confirmSnippetDialog();
            });
        }

        // 点击弹窗遮罩关闭
        const snippetDialog = document.getElementById('snippet-dialog');
        if (snippetDialog) {
            snippetDialog.addEventListener('click', (e: MouseEvent) => {
                if (e.target === snippetDialog) {
                    this.closeSnippetDialog();
                }
            });
        }

        // 弹窗内 Ctrl/Cmd+Enter 确认
        const snippetDialogContent = document.getElementById('snippet-dialog-content');
        if (snippetDialogContent) {
            snippetDialogContent.addEventListener('keydown', (e: KeyboardEvent) => {
                if (modKey(e) && e.key === 'Enter') {
                    e.preventDefault();
                    this.confirmSnippetDialog();
                }
            });
        }

        const closePreviewBtn = document.getElementById('close-preview');
        if (closePreviewBtn) {
            closePreviewBtn.addEventListener('click', () => {
                this.closePreview();
            });
        }

        const previewDialog = document.getElementById('preview-dialog');
        if (previewDialog) {
            previewDialog.addEventListener('click', (e: MouseEvent) => {
                if (e.target === previewDialog) {
                    this.closePreview();
                }
            });
        }

        const cppTemplateTextarea = document.getElementById('cpp-template') as HTMLTextAreaElement | null;
        if (cppTemplateTextarea) {
            cppTemplateTextarea.addEventListener('input', (e: Event) => {
                const target = e.target as HTMLTextAreaElement;
                this.settings.cppTemplate = target.value;
                logInfo('模板内容已更新');
            });

            cppTemplateTextarea.addEventListener('keydown', (e: KeyboardEvent) => {
                // macOS 使用 Cmd+S，Windows/Linux 使用 Ctrl+S
                if (modKey(e) && e.key === 's') {
                    e.preventDefault();
                    this.saveSettings();
                }

                if (e.key === 'Tab') {
                    e.preventDefault();
                    const target = e.target as HTMLTextAreaElement;
                    const start = target.selectionStart ?? 0;
                    const end = target.selectionEnd ?? 0;
                    const value = target.value;

                    target.value = value.substring(0, start) + '    ' + value.substring(end);
                    target.selectionStart = start + 4;
                    target.selectionEnd = start + 4;
                }
            });
        }

        // 监听全局键盘事件，支持 Cmd/Ctrl+S 在任意位置保存
        document.addEventListener('keydown', (e: KeyboardEvent) => {
            if (modKey(e) && e.key === 's') {
                // 如果焦点在弹窗内的输入框，不触发全局保存
                const activeEl = document.activeElement;
                if (activeEl && activeEl.closest('#snippet-dialog')) {
                    return;
                }
                e.preventDefault();
                this.saveSettings();
            }
        });
    }

    async loadSettings() {
        try {
            logInfo('加载设置中...');

            if (window.electronAPI && window.electronAPI.getAllSettings) {
                const allSettings = await window.electronAPI.getAllSettings();
                if (allSettings && typeof allSettings === 'object') {
                    if (allSettings.cppTemplate) {
                        this.settings.cppTemplate = String(allSettings.cppTemplate);
                    }
                    if (Array.isArray(allSettings.codeSnippets)) {
                        this.snippets = allSettings.codeSnippets.map((s: unknown) => ({
                            keyword: String((s as Record<string, unknown>).keyword || ''),
                            description: String((s as Record<string, unknown>).description || ''),
                            content: String((s as Record<string, unknown>).content || '')
                        }));
                        logInfo('从Electron API获取设置成功');
                    }
                }
            } else if (window.electronIPC && window.electronIPC.invoke) {
                logInfo('Electron API不可用，尝试使用ipcRenderer');

                const allSettings = await window.electronIPC.invoke('get-all-settings');
                if (allSettings && typeof allSettings === 'object') {
                    if ((allSettings as Record<string, unknown>).cppTemplate) {
                        this.settings.cppTemplate = String((allSettings as Record<string, unknown>).cppTemplate);
                    }
                    if (Array.isArray((allSettings as Record<string, unknown>).codeSnippets)) {
                        this.snippets = ((allSettings as Record<string, unknown>).codeSnippets as unknown[]).map((s: unknown) => ({
                            keyword: String((s as Record<string, unknown>).keyword || ''),
                            description: String((s as Record<string, unknown>).description || ''),
                            content: String((s as Record<string, unknown>).content || '')
                        }));
                        logInfo('从ipcRenderer获取设置成功');
                    }
                }
            }

            logInfo('模板设置加载完成:', this.settings);
        } catch (error) {
            logError('加载模板设置失败:', error);
            this.showMessage('加载设置失败，使用默认模板', 'error');
        }
    }

    updateUI() {
        logInfo('更新UI界面');

        const cppTemplateTextarea = document.getElementById('cpp-template') as HTMLTextAreaElement | null;
        if (cppTemplateTextarea) {
            cppTemplateTextarea.value = this.settings.cppTemplate;
            logInfo('模板内容已加载到编辑器');
        } else {
            logError('找不到模板编辑器元素');
        }
        this.renderSnippets();
    }

    async saveSettings() {
        try {
            logInfo('保存设置中...');

            const cppTemplateTextarea = document.getElementById('cpp-template') as HTMLTextAreaElement | null;
            if (!cppTemplateTextarea) {
                throw new Error('找不到模板编辑器');
            }

            const cppTemplate = cppTemplateTextarea.value.trim();

            // 允许文件模板为空，只要有关键词代码片段即可保存
            if (!cppTemplate && (!this.snippets || this.snippets.length === 0)) {
                this.showMessage('模板内容和代码片段不能同时为空，请至少填写一项', 'error');
                return;
            }

            const newSettings = {
                cppTemplate: cppTemplate,
                codeSnippets: this.snippets
            };

            logInfo('准备保存的设置:', newSettings);

            let result: { success?: boolean; error?: string } | null = null;
            if (window.electronAPI && window.electronAPI.updateSettings) {
                result = await window.electronAPI.updateSettings(newSettings as Record<string, unknown>);
            } else if (window.electronIPC && window.electronIPC.invoke) {
                result = await window.electronIPC.invoke('update-settings', newSettings);
            }

            if (result && result.success) {
                this.showMessage((window.i18n ? window.i18n.t('templates.saveSuccess') : '模板设置保存成功！'), 'success');
                logInfo('设置保存成功');
            } else {
                const errorMsg = result ? result.error : '未知错误';
                this.showMessage((window.i18n ? window.i18n.t('templates.saveFail', { error: errorMsg }) : '保存设置失败：' + errorMsg), 'error');
                logError('保存设置失败:', errorMsg);
            }

        } catch (error) {
            logError('保存模板设置失败:', error);
            this.showMessage('保存设置失败：' + String((error as Error).message), 'error');
        }
    }

    async resetSettings() {
        try {
            logInfo('重置设置中...');

            if (confirm('确定要重置模板为默认设置吗？这将丢失当前的自定义模板。')) {
                const defaultTemplate = '';
                this.settings.cppTemplate = defaultTemplate;
                this.snippets = [];

                const cppTemplateTextarea = document.getElementById('cpp-template') as HTMLTextAreaElement | null;
                if (cppTemplateTextarea) {
                    cppTemplateTextarea.value = defaultTemplate;
                }

                const newSettings = { cppTemplate: defaultTemplate, codeSnippets: [] as SnippetItem[] };

                let result: { success?: boolean; error?: string } | null = null;
                if (window.electronAPI && window.electronAPI.updateSettings) {
                    result = await window.electronAPI.updateSettings(newSettings as Record<string, unknown>);
                } else if (window.electronIPC && window.electronIPC.invoke) {
                    result = await window.electronIPC.invoke('update-settings', newSettings);
                }

                if (result && result.success) {
                    this.showMessage((window.i18n ? window.i18n.t('templates.resetSuccess') : '模板与片段已重置为默认设置'), 'success');
                    logInfo('设置重置成功');
                } else {
                    this.showMessage('重置设置失败：' + (result ? result.error : '未知错误'), 'error');
                }
            }
        } catch (error) {
            logError('重置设置失败:', error);
            this.showMessage('重置设置失败：' + String((error as Error).message), 'error');
        }
    }

    // 打开片段添加/编辑弹窗
    openSnippetDialog(editIndex = -1) {
        const dialog = document.getElementById('snippet-dialog');
        if (!dialog) return;

        const kwEl = document.getElementById('snippet-dialog-keyword') as HTMLInputElement | null;
        const descEl = document.getElementById('snippet-dialog-desc') as HTMLInputElement | null;
        const contentEl = document.getElementById('snippet-dialog-content') as HTMLTextAreaElement | null;

        // 如果是编辑模式，加载已有数据
        if (editIndex >= 0 && editIndex < this.snippets.length) {
            const item = this.snippets[editIndex];
            if (kwEl) kwEl.value = item.keyword || '';
            if (descEl) descEl.value = item.description || '';
            if (contentEl) contentEl.value = item.content || '';
            dialog.setAttribute('data-edit-index', String(editIndex));
            const titleEl = document.getElementById('snippet-dialog-title');
            if (titleEl) titleEl.textContent = '编辑代码片段';
        } else {
            if (kwEl) kwEl.value = '';
            if (descEl) descEl.value = '';
            if (contentEl) contentEl.value = '';
            dialog.removeAttribute('data-edit-index');
            const titleEl = document.getElementById('snippet-dialog-title');
            if (titleEl) titleEl.textContent = '添加代码片段';
        }

        dialog.style.display = 'block';
        // 自动聚焦到关键词输入框
        setTimeout(() => {
            if (kwEl) kwEl.focus();
        }, 100);
    }

    closeSnippetDialog() {
        const dialog = document.getElementById('snippet-dialog');
        if (dialog) {
            dialog.style.display = 'none';
        }
    }

    confirmSnippetDialog() {
        const kwEl = document.getElementById('snippet-dialog-keyword') as HTMLInputElement | null;
        const descEl = document.getElementById('snippet-dialog-desc') as HTMLInputElement | null;
        const contentEl = document.getElementById('snippet-dialog-content') as HTMLTextAreaElement | null;
        const keyword = (kwEl?.value || '').trim();
        const description = (descEl?.value || '').trim() || '用户代码片段';
        const content = (contentEl?.value || '').trim();

        if (!keyword) {
            this.showMessage('请输入片段关键词', 'warning');
            if (kwEl) kwEl.focus();
            return;
        }
        if (!content) {
            this.showMessage('请输入片段内容', 'warning');
            if (contentEl) contentEl.focus();
            return;
        }

        const dialog = document.getElementById('snippet-dialog');
        const editIndex = dialog ? parseInt(dialog.getAttribute('data-edit-index') || '-1', 10) : -1;

        if (Number.isFinite(editIndex) && editIndex >= 0 && editIndex < this.snippets.length) {
            // 编辑模式：更新已有片段
            this.snippets[editIndex] = { keyword, description, content };
            this.showMessage('片段已更新，点击保存写入设置', 'success');
        } else {
            // 添加模式：检查重复关键词
            const idx = this.snippets.findIndex((s) => (s.keyword || '').toLowerCase() === keyword.toLowerCase());
            if (idx >= 0) {
                this.snippets[idx] = { keyword, description, content };
                this.showMessage('已覆盖同名片段，点击保存写入设置', 'success');
            } else {
                this.snippets.push({ keyword, description, content });
                this.showMessage('片段已添加，点击保存写入设置', 'success');
            }
        }

        this.closeSnippetDialog();
        this.renderSnippets();
    }

    renderSnippets() {
        const list = document.getElementById('snippets-list');
        if (!list) return;
        if (!this.snippets || this.snippets.length === 0) {
            list.innerHTML = '<div style="opacity:.8; font-size:12px; padding:6px;">' + (window.i18n ? window.i18n.t('templates.emptySnippetList') : 'No snippets yet. Click the Add button above to add a code snippet.') + '</div>';
            return;
        }
        const rows = this.snippets.map((s, i) => {
            const k = this.escapeHtml(s.keyword || '');
            const d = this.escapeHtml(s.description || '');
            return `
                <div class="snippet-row" data-index="${i}" style="display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid var(--settings-border);">
                    <div style="flex:0 0 160px; font-weight:600;">${k}</div>
                    <div style="flex:1; opacity:.85;">${d}</div>
                    <button class="preview-btn" data-action="edit" style="background:#6c757d;">编辑</button>
                    <button class="preview-btn" data-action="delete" style="background:#dc3545;">删除</button>
                </div>`;
        }).join('');
        list.innerHTML = rows;
        list.querySelectorAll('button[data-action]')?.forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const row = (e.target as HTMLElement).closest('.snippet-row') as HTMLElement | null;
                const idx = parseInt(row?.dataset.index || '-1', 10);
                const action = (e.target as HTMLElement).dataset.action;
                if (Number.isNaN(idx) || idx < 0) return;
                if (action === 'delete') {
                    this.snippets.splice(idx, 1);
                    this.renderSnippets();
                } else if (action === 'edit') {
                    this.openSnippetDialog(idx);
                }
            });
        });
    }

    escapeHtml(s: string) {
        return s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    showPreview() {
        logInfo('显示模板预览');

        const cppTemplateTextarea = document.getElementById('cpp-template') as HTMLTextAreaElement | null;
        if (!cppTemplateTextarea) {
            this.showMessage('找不到模板内容', 'error');
            return;
        }

        const templateContent = cppTemplateTextarea.value || (window.i18n ? window.i18n.t('templates.templateEmpty') : '// Template content is empty');

        const previewContent = document.getElementById('preview-content');
        if (previewContent) {
            previewContent.textContent = templateContent;
        }

        const previewDialog = document.getElementById('preview-dialog');
        if (previewDialog) {
            previewDialog.style.display = 'block';
        }
    }

    closePreview() {
        logInfo('关闭模板预览');

        const previewDialog = document.getElementById('preview-dialog');
        if (previewDialog) {
            previewDialog.style.display = 'none';
        }
    }

    showMessage(message: string, type = 'info') {
        logInfo(`显示消息: [${type}] ${message}`);

        const existingToast = document.querySelector('.message-toast');
        if (existingToast) {
            existingToast.remove();
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = `message-toast ${type}`;
        messageDiv.textContent = message;
        try {
            if (type === 'error') {
                const errObj = new Error(String(message));
                logError('[TemplateSettingsToastError]', { message: String(message), stack: errObj.stack });
            }
        } catch (_) {}

        document.body.appendChild(messageDiv);

        requestAnimationFrame(() => {
            messageDiv.style.opacity = '1';
        });

        setTimeout(() => {
            messageDiv.style.opacity = '0';
            setTimeout(() => {
                if (messageDiv.parentNode) {
                    messageDiv.parentNode.removeChild(messageDiv);
                }
            }, 300);
        }, 3000);
    }

    closeWindow() {
        logInfo('关闭窗口');

        if (window.close) {
            window.close();
        } else {
            logWarn('window.close 不可用');
        }
    }
}

window.addEventListener('DOMContentLoaded', () => {
    logInfo('DOM加载完成，初始化模板设置');

    try {
        new TemplatesSettings();
    } catch (error) {
        logError('初始化模板设置失败:', error);
    }
});

window.TemplatesSettings = TemplatesSettings;
