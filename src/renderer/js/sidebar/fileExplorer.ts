export {};

interface FileEntry {
    name: string;
    path: string;
    type: 'folder' | 'file';
    extension?: string;
}

interface ClipboardData {
    files: FileEntry[];
    operation: 'copy' | 'cut';
}

class FileExplorer {
    currentPath = '';
    workspacePath = '';
    files: FileEntry[] = [];
    selectedFile: FileEntry | null = null;
    selectedFiles = new Map<string, FileEntry>();
    hasWorkspace = false;
    clipboard: ClipboardData | null = null;
    expandedFolders = new Set<string>();
    _directoryReadRequests = new Map<string, Promise<FileEntry[]>>();
    _treeItemsByPath = new Map<string, HTMLElement>();
    _draggingItems = new Set<HTMLElement>();
    _dragOverItem: HTMLElement | null = null;
    _pendingDragOverTarget: HTMLElement | null = null;
    _pendingDragOverRoot = false;
    _dragHoverFrame: number | null = null;
    isDragging = false;

    // DOM 缓存（批次 1）
    private _fileTree: HTMLElement | null = null;
    private _searchInput: HTMLInputElement | null = null;
    private _newFileBtn: HTMLElement | null = null;
    private _newFolderBtn: HTMLElement | null = null;
    private _refreshBtn: HTMLElement | null = null;
    private _deleteBtn: HTMLElement | null = null;

    constructor() {
        this.setupKeyboardShortcuts();
    }

    validateFileName(name: string): { valid: boolean; error: string } {
        if (!name || typeof name !== 'string') {
            return { valid: false, error: window.i18n ? window.i18n.t('fileExplorer.nameRequired') : '名称不能为空' };
        }

        const trimmedName = name.trim();
        if (trimmedName.length === 0) {
            return { valid: false, error: window.i18n ? window.i18n.t('fileExplorer.nameRequired') : '名称不能为空' };
        }

        const illegalCharsWin = /[<>:"/\\|?*]/;
        const illegalCharsUnix = /\//;

        const isWindows = navigator.platform?.toLowerCase().includes('win') ||
            navigator.userAgent?.toLowerCase().includes('windows');

        const illegalChars = isWindows ? illegalCharsWin : illegalCharsUnix;

        if (illegalChars.test(trimmedName)) {
            const platformMsg = isWindows
                ? '文件名不能包含以下字符: < > : " / \\ | ? *'
                : '文件名不能包含字符: /';
            return { valid: false, error: platformMsg };
        }

        if (isWindows) {
            const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;
            if (reservedNames.test(trimmedName)) {
                return { valid: false, error: window.i18n ? window.i18n.t('fileExplorer.reservedName') : '该名称为系统保留名称，不能使用' };
            }
        }

        return { valid: true, error: '' };
    }

    setupKeyboardShortcuts() {
        // 设置键盘快捷键（后续批次补充）
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
        logInfo(`[文件资源管理器][${type || 'info'}] ${message}`);
    }

    // ========== 批次 1：DOM 缓存与初始化 ==========

    cacheDOM(): void {
        this._fileTree = document.querySelector<HTMLElement>('.file-tree');
        this._searchInput = document.querySelector<HTMLInputElement>('.file-search-input');

        const panel = document.querySelector<HTMLElement>('#files-panel');
        if (!panel) {
            return;
        }
        const buttons = panel.querySelectorAll<HTMLElement>('.icon-btn');
        this._newFileBtn = buttons.item(0);
        this._newFolderBtn = buttons.item(1);
        this._refreshBtn = buttons.item(2);
        this._deleteBtn = buttons.item(3);
    }

    init(): void {
        this.cacheDOM();
        this.setupEventListeners();
        this.loadSettings();
    }

    loadSettings(): void {
        const api = window.electronAPI;
        if (!api?.getSettings) {
            logWarn('electronAPI.getSettings 不可用，跳过加载设置');
            return;
        }
        api.getSettings().catch((error: unknown) => {
            logWarn('加载设置失败', error);
        });
    }

    setupEventListeners(): void {
        // 搜索输入
        if (this._searchInput) {
            this._searchInput.addEventListener('input', (event: Event) => {
                const target = event.target as HTMLInputElement | null;
                this.searchFiles(target ? target.value : '');
            });
        }

        // 新建文件
        if (this._newFileBtn) {
            this._newFileBtn.addEventListener('click', () => {
                this.createNewFile();
            });
        }

        // 新建文件夹
        if (this._newFolderBtn) {
            this._newFolderBtn.addEventListener('click', () => {
                this.createNewFolder();
            });
        }

        // 刷新
        if (this._refreshBtn) {
            this._refreshBtn.addEventListener('click', () => {
                this.refresh();
            });
        }

        // 批量删除
        if (this._deleteBtn) {
            this._deleteBtn.addEventListener('click', () => {
                this.batchDelete();
            });
        }
    }

    // ========== 后续批次占位（在后续批次中实现）==========

    async loadDirectory(path: string): Promise<void> {
        if (!path || !this.hasWorkspace) {
            this.files = [];
            this.renderFileTree();
            return;
        }

        const api = window.electronAPI;
        if (!api?.walkDirectory) {
            logWarn('electronAPI.walkDirectory 不可用');
            this.files = [];
            this.renderFileTree();
            return;
        }

        try {
            const result = await api.walkDirectory(path);
            const entries = (result && result.files) || [];
            const files: FileEntry[] = entries.map((entry: Record<string, unknown>) => ({
                name: String(entry.name || ''),
                path: String(entry.path || ''),
                type: (entry.ext ? 'file' : 'folder') as 'folder' | 'file',
                extension: typeof entry.ext === 'string' ? entry.ext : undefined
            }));
            this.files = files;
            this.renderFileTree();
        } catch (error) {
            logWarn('加载目录失败', error);
            this.files = [];
            this.renderFileTree();
        }
    }

    renderFileTree(): void {
        const fileTree = this._fileTree || document.querySelector<HTMLElement>('.file-tree');
        if (!fileTree) return;

        if (!this.hasWorkspace) {
            fileTree.innerHTML = '<div class="empty-state">没有打开的文件夹</div>';
            this._treeItemsByPath.clear();
            return;
        }

        fileTree.innerHTML = '';
        this._treeItemsByPath.clear();
        const fragment = document.createDocumentFragment();

        this.files
            .filter((file) => this._isVisible(file))
            .forEach((file) => {
                const item = this.createTreeItem(file);
                fragment.appendChild(item);
                this._treeItemsByPath.set(file.path, item);
            });

        fileTree.appendChild(fragment);
    }

    private _isVisible(file: FileEntry): boolean {
        // 顶层项（当前工作区直接下的）始终可见；子项需其所有祖先文件夹均展开
        let visible = true;
        this.files.forEach((folder) => {
            if (folder.type !== 'folder') return;
            if (file.path === folder.path) return;
            if (file.path.startsWith(folder.path + '/') && !this.expandedFolders.has(folder.path)) {
                visible = false;
            }
        });
        return visible;
    }

    createTreeItem(file: FileEntry): HTMLElement {
        const item = document.createElement('div');
        item.className = 'tree-item';
        item.dataset.path = file.path;
        item.dataset.type = file.type;

        const content = document.createElement('div');
        content.className = 'tree-item-content';

        if (file.type === 'folder') {
            const arrow = document.createElement('span');
            arrow.className = 'tree-item-arrow';
            arrow.textContent = '▶';
            content.appendChild(arrow);
        }

        const icon = document.createElement('span');
        icon.className = 'tree-item-icon';
        icon.textContent = this.getFileIconText(file);
        content.appendChild(icon);

        const label = document.createElement('span');
        label.className = 'tree-item-label';
        label.textContent = file.name;
        content.appendChild(label);

        item.appendChild(content);

        if (file.type === 'folder') {
            item.addEventListener('click', (event: MouseEvent) => {
                event.stopPropagation();
                this.toggleFolder(file.path);
            });
        }

        return item;
    }

    private getFileIconText(file: FileEntry): string {
        if (file.type === 'folder') {
            return '📁';
        }
        const ext = (file.extension || '').toLowerCase();
        const iconMap: Record<string, string> = {
            '.cpp': '📄', '.cc': '📄', '.cxx': '📄', '.c': '📄',
            '.h': '📄', '.hpp': '📄',
            '.md': '📝', '.txt': '📝',
            '.json': '📋',
            '.in': '📥', '.out': '📤', '.ans': '✅',
            '.pdf': '📕'
        };
        return iconMap[ext] || '📄';
    }

    toggleFolder(path: string): void {
        if (!path) return;
        if (this.expandedFolders.has(path)) {
            this.expandedFolders.delete(path);
        } else {
            this.expandedFolders.add(path);
        }
        this.renderFileTree();
    }

    async createNewFile(): Promise<void> {
        if (!this.hasWorkspace) {
            logInfo('没有工作区，无法创建文件');
            return;
        }

        try {
            const dm = window.dialogManager as {
                showNewFileDialog?: (msg: string, defaultName: string) => Promise<unknown>;
                showNewFolderDialog?: () => Promise<unknown>;
            } | undefined;
            if (!dm || typeof dm.showNewFileDialog !== 'function') {
                this.showMessage('对话框不可用，无法创建文件', 'error');
                return;
            }

            const fileName = await dm.showNewFileDialog('', 'untitled.cpp');
            if (!fileName || typeof fileName !== 'string') return;

            const trimmed = fileName.trim();
            const validation = this.validateFileName(trimmed);
            if (!validation.valid) {
                this.showMessage(validation.error, 'error');
                return;
            }

            let name = trimmed;
            if (!name.includes('.')) {
                name = name + '.cpp';
            }

            const filePath = this.currentPath + '/' + name;
            if (this.files.some((f) => f.path === filePath)) {
                this.showMessage(`文件 "${name}" 已存在`, 'error');
                return;
            }

            const ipc = window.electronIPC;
            if (!ipc) {
                this.showMessage('文件创建功能需要在完整应用环境中运行', 'error');
                return;
            }

            const defaultContent = '';
            ipc.send('create-file', filePath, defaultContent);

            const handler = (_event: unknown, createdPath: unknown, error: unknown) => {
                if (String(createdPath) === filePath) {
                    if (error) {
                        this.showMessage(`创建文件失败: ${String(error)}`, 'error');
                    } else {
                        this.refresh();
                        if (window.tabManager?.openFile) {
                            window.tabManager.openFile(name, defaultContent, false, { filePath });
                        }
                    }
                }
            };
            window.electronIPC.on('file-created', handler);
        } catch (error) {
            logError('创建文件时出错:', error);
            this.showMessage(`创建文件失败: ${String(error)}`, 'error');
        }
    }

    async createNewFolder(): Promise<void> {
        if (!this.hasWorkspace) {
            logInfo('没有工作区，无法创建文件夹');
            return;
        }

        try {
            const dm = window.dialogManager as {
                showNewFileDialog?: (msg: string, defaultName: string) => Promise<unknown>;
                showNewFolderDialog?: () => Promise<unknown>;
            } | undefined;
            if (!dm || typeof dm.showNewFolderDialog !== 'function') {
                this.showMessage('对话框不可用，无法创建文件夹', 'error');
                return;
            }

            const folderName = await dm.showNewFolderDialog();
            if (!folderName || typeof folderName !== 'string') return;

            const trimmed = folderName.trim();
            const validation = this.validateFileName(trimmed);
            if (!validation.valid) {
                this.showMessage(validation.error, 'error');
                return;
            }

            const folderPath = this.currentPath + '/' + trimmed;
            if (this.files.some((f) => f.path === folderPath)) {
                this.showMessage(`文件夹 "${trimmed}" 已存在`, 'error');
                return;
            }

            const ipc = window.electronIPC;
            if (!ipc) {
                this.showMessage('文件夹创建功能需要在完整应用环境中运行', 'error');
                return;
            }

            ipc.send('create-folder', folderPath);

            const handler = (_event: unknown, createdPath: unknown, error: unknown) => {
                if (String(createdPath) === folderPath) {
                    if (error) {
                        this.showMessage(`创建文件夹失败: ${String(error)}`, 'error');
                    } else {
                        this.refresh();
                    }
                }
            };
            window.electronIPC.on('folder-created', handler);
        } catch (error) {
            logError('创建文件夹时出错:', error);
            this.showMessage(`创建文件夹失败: ${String(error)}`, 'error');
        }
    }

    async renameFile(file: FileEntry): Promise<void> {
        if (!file) {
            logWarn('renameFile 调用时未提供有效文件');
            return;
        }

        const name = file.name;
        const lastDot = name.lastIndexOf('.');
        let selectEnd = name.length;
        if (file.type !== 'folder' && lastDot > 0) {
            selectEnd = lastDot;
        }

        const dm = window.dialogManager as {
            showInputDialog?: (title: string, defaultValue: string, placeholder: string, options?: { selectStart?: number; selectEnd?: number }) => Promise<unknown>;
        } | undefined;
        if (!dm || typeof dm.showInputDialog !== 'function') {
            this.showMessage('对话框不可用，无法重命名', 'error');
            return;
        }

        const newName = await dm.showInputDialog('重命名', name, '请输入新名称', { selectStart: 0, selectEnd });
        if (!newName || typeof newName !== 'string') return;

        const trimmedName = newName.trim();
        if (!trimmedName || trimmedName === file.name) return;

        const validation = this.validateFileName(trimmedName);
        if (!validation.valid) {
            this.showMessage(validation.error, 'error');
            return;
        }

        const ipc = window.electronIPC;
        if (!ipc) {
            this.showMessage('文件重命名功能需要在完整应用环境中运行', 'error');
            return;
        }

        ipc.send('rename-file', file.path, trimmedName);

        const handler = (_event: unknown, oldPath: unknown, newPath: unknown, error: unknown) => {
            if (String(oldPath) === file.path) {
                if (error) {
                    this.showMessage(`重命名失败: ${String(error)}`, 'error');
                } else {
                    logInfo('文件重命名成功:', file.path, '->', String(newPath));
                    this.refresh();
                }
            }
        };
        window.electronIPC.on('file-renamed', handler);
    }

    deleteFile(_file: FileEntry): void {
        // 批次 3 实现
    }

    selectFile(filePath: string): void {
        if (!filePath) return;

        const file = this.files.find((f) => f.path === filePath);
        if (!file) return;

        this.selectedFiles.clear();
        this.selectedFiles.set(file.path, file);
        this.selectedFile = file;

        this.applySelectionStyles();

        const item = this._treeItemsByPath.get(file.path);
        if (item) {
            item.setAttribute('tabindex', '0');
            item.focus();
        }

        logInfo('选择文件:', file.name);
    }

    private applySelectionStyles(): void {
        const fileTree = this._fileTree || document.querySelector<HTMLElement>('.file-tree');
        if (!fileTree) return;
        const selectedPaths = new Set(this.selectedFiles.keys());
        fileTree.querySelectorAll('.tree-item').forEach((item) => {
            const el = item as HTMLElement;
            const isSelected = selectedPaths.has(el.dataset?.path ?? '');
            el.classList.toggle('selected', isSelected);
        });
    }

    copyFile(): void {
        // 批次 4 实现
    }

    cutFile(): void {
        // 批次 4 实现
    }

    pasteFile(): void {
        // 批次 4 实现
    }

    searchFiles(_query: string): void {
        // 批次 5 实现
    }

    refresh(): void {
        // 批次 5 实现
    }

    batchDelete(): void {
        // 批次 3 实现（由 sidebar.ts 调用）
    }

    async openFile(file: FileEntry): Promise<void> {
        if (file.type !== 'file') return;

        logInfo('打开文件:', file.name);

        const api = window.electronAPI;
        if (!api?.readFileContent) {
            logWarn('electronAPI.readFileContent 不可用');
            return;
        }

        try {
            const content = await api.readFileContent(file.path);
            const tabManager = window.tabManager;
            if (tabManager?.openFile) {
                tabManager.openFile(file.name, content, false, { filePath: file.path });
            } else {
                logWarn('tabManager 不可用，无法打开文件');
            }
        } catch (error) {
            logError('读取文件失败:', error);
            this.showMessage(`无法读取文件: ${String(error)}`, 'error');
        }
    }

    activate(): void {
        if (this.hasWorkspace && this.currentPath) {
            this.loadDirectory(this.currentPath);
        }
    }

    getActiveFilePath(): string | null {
        return null;
    }

    isCloudFilePath(_path: string): boolean {
        return false;
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const fileExplorer = new FileExplorer();
    (window as { fileExplorer?: FileExplorer }).fileExplorer = fileExplorer;
});
