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
        this.setupDragAndDrop(fileTree);
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

        item.draggable = true;
        item.addEventListener('dragstart', (event: DragEvent) => {
            this.handleDragStart(event, file);
        });

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

    async deleteFile(file: FileEntry): Promise<void> {
        if (!file) {
            logWarn('deleteFile 调用时未提供有效文件');
            return;
        }

        logInfo('删除文件:', file.name);

        const confirmed = await this.confirmDelete(`确定要删除 "${file.name}" 吗？`);
        if (!confirmed) return;

        const ipc = window.electronIPC;
        if (!ipc) {
            this.showMessage('文件删除功能需要在完整应用环境中运行', 'error');
            return;
        }

        ipc.send('delete-file', file.path);

        const handler = (_event: unknown, deletedPath: unknown, error: unknown) => {
            if (String(deletedPath) === file.path) {
                if (error) {
                    this.showMessage(`删除失败: ${String(error)}`, 'error');
                } else {
                    this.selectedFiles.delete(file.path);
                    if (this.selectedFile && this.selectedFile.path === file.path) {
                        this.selectedFile = this.selectedFiles.size ? this.selectedFiles.values().next().value : null;
                    }
                    this.refresh();
                }
            }
        };
        window.electronIPC.on('file-deleted', handler);
    }

    private async confirmDelete(message: string): Promise<boolean> {
        const dm = window.dialogManager;
        if (dm && typeof dm.showConfirmDialog === 'function') {
            const result = await dm.showConfirmDialog('删除文件', message);
            return result !== null && result !== undefined && result !== false;
        }
        return window.confirm?.(message) ?? true;
    }

    async batchDelete(): Promise<void> {
        if (!this.hasWorkspace) {
            this.showMessage('没有打开的工作区', 'error');
            return;
        }

        const selected = Array.from(this.selectedFiles.values());
        if (selected.length === 0) {
            this.showMessage('未选中任何文件', 'error');
            return;
        }

        const confirmed = await this.confirmDelete(`确定要删除这 ${selected.length} 个项目吗？`);
        if (!confirmed) return;

        for (const file of selected) {
            try {
                await this.deleteFile(file);
            } catch (error) {
                logError('批量删除文件时出错:', error);
            }
        }
        this.refresh();
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

    copyFile(files: FileEntry | FileEntry[]): void {
        const fileList = Array.isArray(files) ? files : [files];
        const valid = fileList.filter((f) => f?.path);
        if (!valid.length) {
            logWarn('copyFile 调用时未提供有效文件');
            return;
        }
        this.clipboard = { files: valid, operation: 'copy' };
        logInfo('复制文件:', valid.map((f) => f.name));
    }

    cutFile(files: FileEntry | FileEntry[]): void {
        const fileList = Array.isArray(files) ? files : [files];
        const valid = fileList.filter((f) => f?.path);
        if (!valid.length) {
            logWarn('cutFile 调用时未提供有效文件');
            return;
        }
        this.clipboard = { files: valid, operation: 'cut' };
        logInfo('剪切文件:', valid.map((f) => f.name));
    }

    pasteFile(targetFolder?: FileEntry): void {
        if (!this.clipboard) {
            logWarn('尝试粘贴但剪贴板为空');
            return;
        }
        if (!this.hasWorkspace || !this.currentPath) {
            logWarn('尝试粘贴但当前没有有效工作区');
            return;
        }

        if (!targetFolder) {
            targetFolder = this.getPasteTargetFolder();
            logInfo('未提供 targetFolder，自动推断为:', targetFolder);
        }

        if (!targetFolder || !targetFolder.path) {
            logError('粘贴失败：无法确定目标文件夹', targetFolder);
            return;
        }

        const targetPath = targetFolder.type === 'folder' ? targetFolder.path : this.currentPath;
        logInfo('粘贴文件到:', targetPath);
        logInfo('粘贴的文件:', this.clipboard.files.map((f) => f.name));
        logInfo('操作类型:', this.clipboard.operation);

        const ipc = window.electronIPC;
        if (!ipc) {
            this.showMessage('文件粘贴功能需要在完整应用环境中运行', 'error');
            return;
        }

        const normPath = (p: string) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
        const tgtNorm = normPath(targetPath);

        this.clipboard.files.forEach((file) => {
            const srcNorm = normPath(file.path);
            if (file.type === 'folder' && (tgtNorm === srcNorm || tgtNorm.startsWith(srcNorm + '/'))) {
                this.showMessage('不能把文件夹粘贴到自身或其子目录', 'error');
                return;
            }
            ipc.send('paste-file', file.path, targetPath, this.clipboard.operation);

            const handler = (_event: unknown, sourcePath: unknown, destPath: unknown, operation: unknown, error: unknown) => {
                if (String(sourcePath) === file.path) {
                    if (error) {
                        const op = this.clipboard.operation === 'copy' ? '复制' : '移动';
                        logError(`${op}文件失败:`, file.name, error);
                        this.showMessage(`${op}失败: ${String(error)}`, 'error');
                    } else {
                        logInfo(`文件${this.clipboard.operation === 'copy' ? '复制' : '移动'}成功:`, file.name, '->', String(destPath));
                    }
                }
            };
            window.electronIPC.on('file-pasted', handler);
        });

        setTimeout(() => this.refresh(), 1000);

        if (this.clipboard.operation === 'cut') {
            this.clipboard = null;
        }
    }

    private getPasteTargetFolder(): FileEntry | null {
        const selected = Array.from(this.selectedFiles.values());
        for (let i = selected.length - 1; i >= 0; i--) {
            if (selected[i]?.type === 'folder') {
                return selected[i];
            }
        }
        if (this.currentPath) {
            return { path: this.currentPath, name: '', type: 'folder' };
        }
        return null;
    }

    // ========== 批次 4：拖放状态辅助 ==========

    private _clearDraggingItems(): void {
        for (const item of this._draggingItems) {
            item?.classList.remove('dragging');
        }
        this._draggingItems.clear();
    }

    private _applyDragHover(fileTree: HTMLElement): void {
        const target = this._pendingDragOverTarget;
        const nextItem = target && target.dataset?.type === 'folder' && fileTree.contains(target) ? target : null;
        if (this._dragOverItem !== nextItem) {
            this._dragOverItem?.classList.remove('drag-over');
            nextItem?.classList.add('drag-over');
            this._dragOverItem = nextItem;
        }
        fileTree.classList.toggle('drag-over-root', this._pendingDragOverRoot && !nextItem);
    }

    private _scheduleDragHover(fileTree: HTMLElement, targetItem: HTMLElement | null): void {
        this._pendingDragOverTarget = targetItem;
        this._pendingDragOverRoot = !targetItem;
        if (this._dragHoverFrame !== null) return;
        const requestFrame = typeof window.requestAnimationFrame === 'function'
            ? window.requestAnimationFrame.bind(window)
            : (callback: () => void) => setTimeout(callback, 0);
        this._dragHoverFrame = requestFrame(() => {
            this._dragHoverFrame = null;
            this._applyDragHover(fileTree);
        });
    }

    private _clearDragIndicators(fileTree: HTMLElement): void {
        if (this._dragHoverFrame !== null) {
            if (typeof window.cancelAnimationFrame === 'function') {
                window.cancelAnimationFrame(this._dragHoverFrame);
            } else {
                clearTimeout(this._dragHoverFrame);
            }
            this._dragHoverFrame = null;
        }
        this._dragOverItem?.classList.remove('drag-over');
        this._dragOverItem = null;
        this._pendingDragOverTarget = null;
        this._pendingDragOverRoot = false;
        fileTree.classList.remove('drag-over-root');
    }

    private _clearDragState(fileTree: HTMLElement): void {
        this._clearDragIndicators(fileTree);
        this._clearDraggingItems();
        this.isDragging = false;
    }

    // ========== 批次 4：拖放核心 ==========

    private isFileSelected(path: string): boolean {
        return !!path && this.selectedFiles.has(path);
    }

    private getActionSelection(targetFile: FileEntry | null): FileEntry[] {
        const selected = Array.from(this.selectedFiles.values());
        if (selected.length > 1 && targetFile && this.isFileSelected(targetFile.path)) {
            return selected;
        }
        if (!targetFile && selected.length > 0) {
            return selected;
        }
        if (targetFile) {
            return [targetFile];
        }
        return [];
    }

    private handleDragStart(event: DragEvent, file: FileEntry): void {
        const filesToDrag = this.getActionSelection(file);
        const dragData = { files: filesToDrag.length ? filesToDrag : [file], action: 'move' as const };
        const dt = event.dataTransfer;
        if (dt) {
            dt.setData('text/plain', JSON.stringify(dragData));
            dt.effectAllowed = 'move';
        }
        dragData.files.forEach((f) => {
            const dragItem = this._treeItemsByPath.get(f.path);
            if (dragItem) {
                dragItem.classList.add('dragging');
                this._draggingItems.add(dragItem);
            }
        });
        logInfo('开始拖拽:', dragData.files.map((f) => f.name));
    }

    private setupDragAndDrop(fileTree: HTMLElement): void {
        const marker = fileTree as HTMLElement & { __oicppDragAndDropBound?: boolean };
        if (marker.__oicppDragAndDropBound) return;
        marker.__oicppDragAndDropBound = true;

        const getItem = (event: Event): HTMLElement | null => {
            const target = event.target as HTMLElement | null;
            const item = target?.closest('.tree-item') as HTMLElement | null;
            return item && fileTree.contains(item) ? item : null;
        };

        fileTree.addEventListener('dragover', (e: DragEvent) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const targetItem = getItem(e);
            this._scheduleDragHover(fileTree, targetItem && fileTree.contains(targetItem) ? targetItem : null);
        });

        fileTree.addEventListener('dragleave', (e: DragEvent) => {
            const related = e.relatedTarget as Node | null;
            if (!fileTree.contains(related ?? undefined)) {
                this._clearDragIndicators(fileTree);
            }
        });

        fileTree.addEventListener('drop', (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();

            if (this.isDragging) {
                logInfo('拖拽操作正在进行中，忽略重复事件');
                return;
            }

            this.isDragging = true;
            this._clearDragIndicators(fileTree);
            this._clearDraggingItems();

            try {
                const dragDataRaw = e.dataTransfer.getData('text/plain');
                const dragData = JSON.parse(dragDataRaw) as { files: FileEntry[]; action: string };
                const targetItem = (e.target as HTMLElement | null)?.closest('.tree-item') as HTMLElement | null;
                let targetPath: string | null = null;
                if (targetItem) {
                    const targetType = targetItem.dataset.type;
                    if (targetType === 'folder') {
                        targetPath = targetItem.dataset.path ?? null;
                    } else {
                        const itemPath = targetItem.dataset.path ?? '';
                        const lastSep = Math.max(itemPath.lastIndexOf('\\'), itemPath.lastIndexOf('/'));
                        targetPath = lastSep >= 0 ? itemPath.substring(0, lastSep) : null;
                    }
                } else {
                    targetPath = this.currentPath || null;
                }

                if (targetPath) {
                    this.moveFiles(dragData.files || [], targetPath).finally(() => {
                        this.isDragging = false;
                    });
                } else {
                    this.isDragging = false;
                }
            } catch (error) {
                logError('处理拖拽数据时出错:', error);
                this.isDragging = false;
            }
        });

        fileTree.addEventListener('dragend', () => {
            this._clearDragState(fileTree);
        });
    }

    private async moveFiles(files: FileEntry[], targetPath: string): Promise<void> {
        logInfo('移动文件:', files.map((f) => f.name), '到:', targetPath);

        const ipc = window.electronIPC;
        if (!ipc) {
            logError('Electron IPC 不可用');
            return;
        }

        try {
            const isSameLocation = files.some((file) => {
                const fileDir = file.path.substring(0, Math.max(file.path.lastIndexOf('\\'), file.path.lastIndexOf('/')));
                return fileDir === targetPath;
            });
            if (isSameLocation) {
                logInfo('文件已在目标位置，无需移动');
                return;
            }

            for (const file of files) {
                const separator = targetPath.includes('\\') ? '\\' : '/';
                const newPath = targetPath + separator + file.name;
                const exists = await ipc.invoke('check-file-exists', newPath);
                if (exists) {
                    const shouldOverwrite = await this.confirmDelete(`文件 "${file.name}" 已存在于目标位置。是否要覆盖？`);
                    if (!shouldOverwrite) {
                        logInfo('用户取消了文件移动操作');
                        return;
                    }
                }
            }

            for (const file of files) {
                await new Promise<void>((resolve, reject) => {
                    let resolved = false;
                    const separator = targetPath.includes('\\') ? '\\' : '/';
                    const newPath = targetPath + separator + file.name;

                    const successHandler = (_event: unknown, oldPath: unknown, movedNewPath: unknown) => {
                        if (String(oldPath) === file.path && String(movedNewPath) === newPath && !resolved) {
                            resolved = true;
                            logInfo(`文件移动成功: ${oldPath} -> ${movedNewPath}`);
                            try {
                                const tabManager = window.tabManager as {
                                    updateTabPathBySource?: (oldPath: string, newPath: string, options?: { skipAutoSave?: boolean }) => void;
                                } | undefined;
                                tabManager?.updateTabPathBySource?.(String(oldPath), String(movedNewPath));
                            } catch (e) { logWarn('移动后更新标签页路径失败:', e); }
                            resolve();
                        }
                    };

                    const errorHandler = (_event: unknown, oldPath: unknown, error: unknown) => {
                        if (String(oldPath) === file.path && !resolved) {
                            resolved = true;
                            logError(`文件移动失败: ${oldPath}, 错误: ${error}`);
                            reject(new Error(String(error)));
                        }
                    };

                    window.electronIPC.on('file-moved', successHandler);
                    window.electronIPC.on('file-move-error', errorHandler);
                    ipc.send('move-file', file.path, newPath);
                });
            }

            this.refresh();
            logInfo('文件移动完成');
        } catch (error) {
            logError('移动文件时出错:', error);
            this.showMessage(`移动文件时出错: ${String(error)}`, 'error');
        }
    }

    searchFiles(_query: string): void {
        // 批次 5 实现
    }

    refresh(): void {
        // 批次 5 实现
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
