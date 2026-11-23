export {};

class TemplatesSettings {
    settings: Record<string, unknown> = {
        cppTemplate: ''
    };
    snippets: Array<Record<string, unknown>> = [];

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
            window.electronIPC.on('theme-changed', (_event, theme: string) => {
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
    }

    async loadSettings() {
        try {
            if (window.electronAPI && window.electronAPI.getAllSettings) {
                const saved = await window.electronAPI.getAllSettings();
                if (saved && typeof saved === 'object') {
                    this.settings = {
                        cppTemplate: saved.cppTemplate || ''
                    };
                }
            }
        } catch (error) {
            logError('加载模板设置失败:', error);
        }
    }

    updateUI() {
        // 更新 UI
    }

    saveSettings() {
        if (window.electronAPI && window.electronAPI.updateSettings) {
            window.electronAPI.updateSettings(this.settings).catch((err) => {
                logError('保存模板设置失败:', err);
            });
        }
    }

    resetSettings() {
        this.settings = {
            cppTemplate: ''
        };
        this.updateUI();
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
        logInfo(`[模板设置][${type || 'info'}] ${message}`);
    }

    closeWindow() {
        window.close();
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new TemplatesSettings();
});
