export {};

class CloudSyncPanel {
    rootPath = '/';
    currentPath = '/';
    itemsCache = new Map<string, unknown>();
    expandedFolders = new Set<string>(['/']);
    selectedItems = new Map<string, unknown>();
    remainingFiles: Record<string, unknown> | null = null;
    allowedExtensions = new Set<string>(['.ans', '.in', '.out', '.cpp', '.py', '.txt', '.md', '.h', '.hpp']);
    maxFileSize = 50 * 1024;
    isLoading = false;
    _lastLoggedIn = false;
    _contextMenu: HTMLElement | null = null;

    treeEl: HTMLElement | null = null;
    summaryEl: HTMLElement | null = null;
    remainingEl: HTMLElement | null = null;
    quotaHelpBtn: HTMLElement | null = null;
    uploadProgressEl: HTMLElement | null = null;
    uploadProgressTextEl: HTMLElement | null = null;
    uploadProgressFillEl: HTMLElement | null = null;

    constructor() {
        this.init();
    }

    init() {
        this.treeEl = document.getElementById('cloud-tree');
        this.summaryEl = document.getElementById('cloud-summary');
        this.remainingEl = document.getElementById('cloud-remaining');
        this.quotaHelpBtn = document.getElementById('cloud-quota-help-btn');
        this.uploadProgressEl = document.getElementById('cloud-upload-progress');
        this.uploadProgressTextEl = document.getElementById('cloud-upload-progress-text');
        this.uploadProgressFillEl = document.getElementById('cloud-upload-progress-fill');
        this.bindQuotaHelpAction();
        this.bindHeaderActions();
        this.setupTreeEvents();
        this.setupKeyboardShortcuts();
        this.renderEmptyState(window.i18n ? window.i18n.t('cloud.loginRequired') : '请先登录账户');
    }

    bindQuotaHelpAction() {
        if (!this.quotaHelpBtn) return;
        this.quotaHelpBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const faqUrl = 'https://oicppide.com/faqs.html';
            try {
                await window.electronAPI?.openExternal?.(faqUrl);
            } catch (_) {
                try { window.open(faqUrl, '_blank'); } catch (_) { }
            }
        });
    }

    bindHeaderActions() {
        const panel = document.getElementById('cloud-panel');
        if (!panel) return;
        panel.querySelectorAll<HTMLElement>('.icon-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                switch (action) {
                    case 'cloud-new-file':
                        this.createNewFile();
                        break;
                    case 'cloud-new-folder':
                        this.createNewFolder();
                        break;
                    case 'cloud-upload':
                        this.uploadLocalFile();
                        break;
                    case 'cloud-upload-folder':
                        this.uploadLocalFolder();
                        break;
                    case 'cloud-refresh':
                        this.refresh();
                        break;
                }
            });
        });
    }

    setupTreeEvents() {
        if (!this.treeEl) return;
        this.treeEl.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const item = target.closest('.tree-item') as HTMLElement | null;
            if (!item) return;
            const path = item.dataset.path;
            const kind = item.dataset.kind;
            if (path && kind === 'folder') {
                this.currentPath = path;
                this.refresh();
            }
        });
    }

    setupKeyboardShortcuts() {
        // 键盘快捷键
    }

    renderEmptyState(message: string) {
        if (this.remainingEl) {
            this.remainingEl.textContent = message;
        }
    }

    async createNewFile() {
        if (!window.electronAPI?.saveAsFile) return;
        const result = await window.electronAPI.saveAsFile('', `${this.currentPath}new-file.cpp`);
        if (result && (result as { canceled?: boolean }).canceled) return;
        this.refresh();
    }

    async createNewFolder() {
        if (!window.electronAPI?.send) return;
        window.electronAPI.send('cloud-create-folder', this.currentPath);
        this.refresh();
    }

    async uploadLocalFile() {
        if (!window.electronAPI?.openFileDialog || !window.electronAPI?.readFile || !window.electronAPI?.writeFile) return;
        const result = await window.electronAPI.openFileDialog({
            title: window.i18n ? window.i18n.t('cloud.uploadFile') : '选择要上传的文件',
            filters: [{ name: 'All Files', extensions: ['*'] }]
        });
        if (result?.canceled || !result?.filePaths?.[0]) return;
        const filePath = result.filePaths[0];
        try {
            const content = await window.electronAPI.readFile(filePath);
            const fileName = filePath.split(/[\\/]/).pop() || 'file';
            const destPath = `${this.currentPath}${fileName}`;
            await window.electronAPI.writeFile(destPath, content);
            this.refresh();
        } catch (_) {
            this.showMessage('上传失败', 'error');
        }
    }

    async uploadLocalFolder() {
        if (!window.electronAPI?.send) return;
        window.electronAPI.send('cloud-upload-folder', this.currentPath);
        this.refresh();
    }

    async refresh() {
        this.isLoading = true;
        if (this.remainingEl) {
            this.remainingEl.textContent = window.i18n ? window.i18n.t('cloud.loading') : '加载中...';
        }
        try {
            if (!window.electronAPI?.walkDirectory) {
                this.isLoading = false;
                return;
            }
            const result = await window.electronAPI.walkDirectory(this.rootPath, {
                excludeGlobs: ['.git/*', 'node_modules/*']
            });
            const files = result?.files || [];
            this.renderFileList(files);
        } catch (_) {
            this.showMessage('刷新失败', 'error');
        } finally {
            this.isLoading = false;
        }
    }

    private renderFileList(files: Array<{ name: string; path: string }>) {
        if (!this.treeEl) return;
        this.treeEl.innerHTML = '';
        for (const file of files) {
            const item = document.createElement('div');
            item.className = 'tree-item';
            item.dataset.path = file.path;
            item.dataset.kind = 'file';
            item.textContent = file.name;
            this.treeEl.appendChild(item);
        }
        const remainingEl = this.remainingEl;
        if (remainingEl) {
            remainingEl.textContent = files.length > 0
                ? (window.i18n ? window.i18n.t('cloud.fileCount', { count: files.length }) : `${files.length} 个文件`)
                : (window.i18n ? window.i18n.t('cloud.empty') : '空目录');
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
        logInfo(`[云同步][${type || 'info'}] ${message}`);
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const cloudSyncPanel = new CloudSyncPanel();
    (window as { cloudSyncPanel?: CloudSyncPanel }).cloudSyncPanel = cloudSyncPanel;
});
