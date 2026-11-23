export {};

class TabManager {
    tabs: Map<string, unknown> = new Map();
    groups: Map<string, unknown> = new Map();
    groupOrder: string[] = [];
    activeGroupId: string | null = null;
    activeTab: Record<string, unknown> | null = null;
    activeTabKey: string | null = null;
    tabOrder: string[] = [];
    monacoEditorManager: unknown = null;
    editorGroupsElement: HTMLElement | null = null;
    welcomeContainer: HTMLElement | null = null;
    splitOverlay: HTMLElement | null = null;
    groupCounter = 1;
    draggedTabInfo: Record<string, unknown> | null = null;
    draggedTab: HTMLElement | null = null;
    placeholder: HTMLElement | null = null;
    tabDragInProgress = false;
    lastTabDropInfo: Record<string, unknown> | null = null;
    dropHandled = false;
    _openingKeys = new Set<string>();
    _watchedFiles = new Map<string, unknown>();
    _fileWatchListenerBound = false;
    _externalFileChangeUnsubscribe: (() => void) | null = null;
    _fileWatchCleanupBound = false;
    _tabContextMenu: HTMLElement | null = null;
    _altWheelListenerBound = false;
    _lastAltWheelSwitchTs = 0;

    handlePdfViewerMessage = (event: MessageEvent) => {
        // 处理 PDF 查看器消息
    };

    constructor() {
        if (typeof window !== 'undefined') {
            this.handlePdfViewerMessage = this.handlePdfViewerMessage.bind(this);
            window.addEventListener('message', this.handlePdfViewerMessage, false);
        }
        this.init();
    }

    init() {
        this.cacheDOM();
        this.initializeGroups();
    }

    cacheDOM() {
        this.editorGroupsElement = document.getElementById('editor-groups');
        this.welcomeContainer = document.getElementById('welcome-container');
        if (!this.editorGroupsElement) {
            logError('TabManager: 未找到编辑器分组容器 #editor-groups');
        }
    }

    initializeGroups() {
        if (!this.editorGroupsElement) {
            this.cacheDOM();
        }

        const groupElements = Array.from(document.querySelectorAll('.editor-group'));
        if (groupElements.length === 0 && this.editorGroupsElement) {
            const defaultGroup = document.createElement('div');
            defaultGroup.className = 'editor-group';
            defaultGroup.dataset.groupId = 'group-1';

            const tabBar = document.createElement('div');
            tabBar.className = 'tab-bar';
            tabBar.dataset.groupId = 'group-1';

            defaultGroup.appendChild(tabBar);
            this.editorGroupsElement.appendChild(defaultGroup);
            this.groupOrder.push('group-1');
            this.groups.set('group-1', { element: defaultGroup, tabs: [] });
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
        logInfo(`[标签管理器][${type || 'info'}] ${message}`);
    }

    getFileNameFromPath(filePath: string | null): string {
        if (!filePath) return '';
        return filePath.replace(/\\/g, '/').split('/').pop() || '';
    }

    generateNewFileName(): string {
        let n = 1;
        while (true) {
            const name = `untitled-${n}.cpp`;
            let exists = false;
            for (const [, data] of this.tabs) {
                if (data && typeof data === 'object' && (data as Record<string, unknown>).fileName === name) {
                    exists = true;
                    break;
                }
            }
            if (!exists) return name;
            n += 1;
        }
    }

    isPdfFile(fileName: string): boolean {
        return fileName.toLowerCase().endsWith('.pdf');
    }

    isWindowsPlatform(): boolean {
        return typeof navigator !== 'undefined' && /Win/.test(navigator.platform);
    }

    base64ToUint8Array(base64: string): Uint8Array {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    normalizePathSlashes(pathCandidate: string | null): string | null {
        if (!pathCandidate) return null;
        return pathCandidate.replace(/\\/g, '/');
    }

    isLikelyFileObject(candidate: unknown): candidate is File {
        return candidate !== null && typeof candidate === 'object' && 'name' in (candidate as Record<string, unknown>);
    }

    isInternalTabDrag(dataTransfer: DataTransfer): boolean {
        try {
            return dataTransfer.types && Array.isArray(dataTransfer.types)
                ? dataTransfer.types.includes('application/oicpp-tab')
                : false;
        } catch (_) {
            return false;
        }
    }

    normalizeDroppedPath(pathCandidate: string | null): string | null {
        return this.normalizePathSlashes(pathCandidate);
    }

    async readFileContent(filePath: string): Promise<string | null> {
        try {
            const w = window as unknown as { oicppApp?: unknown; electronAPI?: unknown };
            if (w.oicppApp && typeof (w.oicppApp as Record<string, unknown>).readFileContent === 'function') {
                const fn = (w.oicppApp as Record<string, unknown>).readFileContent as (...args: unknown[]) => Promise<unknown>;
                const result = await fn(filePath);
                if (typeof result === 'string') return result;
                return null;
            }
            if (w.electronAPI && typeof (w.electronAPI as Record<string, unknown>).readFile === 'function') {
                const fn = (w.electronAPI as Record<string, unknown>).readFile as (...args: unknown[]) => Promise<unknown>;
                const result = await fn(filePath);
                if (typeof result === 'string') return result;
                return null;
            }
            return null;
        } catch (_) {
            return null;
        }
    }

    openFile(fileName: string, content: string = '', isNew: boolean = false, filePath: string | null = null): void {
        // 实际的标签打开逻辑将在后续批次完善
    }

    getGroupTabCount(groupId: string): number {
        if (!groupId) return 0;
        const group = this.groups.get(groupId);
        if (!group) return 0;
        const groupObj = group as Record<string, unknown>;
        const tabBar = groupObj.tabBar as HTMLElement | undefined;
        if (tabBar && typeof tabBar.querySelectorAll === 'function') {
            return tabBar.querySelectorAll('.tab').length;
        }
        const tabs = groupObj.tabs as Map<string, unknown> | undefined;
        if (tabs instanceof Map) {
            return tabs.size;
        }
        return 0;
    }

    canSplitGroup(groupId: string): boolean {
        return this.getGroupTabCount(groupId) > 1;
    }

    bindEditorAreaDnD(editorArea: HTMLElement | null): void {
        if (!editorArea || (editorArea as unknown as Record<string, unknown>)._editorDnDBound) return;
        const onDragOver = (event: DragEvent) => {
            try {
                event.preventDefault();
                event.stopPropagation();
                if (event.dataTransfer) {
                    event.dataTransfer.dropEffect = 'copy';
                }
            } catch (_) { }
        };
        const onDrop = async (event: DragEvent) => {
            try {
                event.preventDefault();
                event.stopPropagation();
                const groupId = editorArea.dataset.groupId || this.activeGroupId || 'group-1';
                await this.processExternalDrop(event.dataTransfer, groupId);
            } catch (err) {
                logWarn('编辑区 drop 处理失败:', err);
            }
        };
        editorArea.addEventListener('dragover', onDragOver, true);
        editorArea.addEventListener('drop', onDrop, true);
        (editorArea as unknown as Record<string, unknown>)._editorDnDBound = true;
    }

    async processExternalDrop(dataTransfer: DataTransfer | null, groupId: string): Promise<boolean> {
        if (!dataTransfer) return false;
        if (this.tabDragInProgress) return false;
        if (this.isInternalTabDrag(dataTransfer)) return false;

        const entries: Array<{ fileName: string; filePath: string | null; fileObject: File | null; base64: string | null }> = [];
        const text = typeof dataTransfer.getData === 'function' ? dataTransfer.getData('text/plain') || '' : '';
        if (text && text.trim().startsWith('{') && text.includes('files')) {
            try {
                const parsed = JSON.parse(text);
                if (parsed && Array.isArray(parsed.files)) {
                    parsed.files.forEach((f: unknown) => {
                        if (!f || typeof f !== 'object') return;
                        const fileObj = f as Record<string, unknown>;
                        if (fileObj.type !== 'file') return;
                        const filePathRaw = typeof fileObj.path === 'string' ? fileObj.path : null;
                        const filePath = this.normalizeDroppedPath(filePathRaw);
                        if (!filePath) return;
                        const fileName = (typeof fileObj.name === 'string' ? fileObj.name : null) || (filePath.split(/[\\\/]/).pop()) || 'untitled';
                        const base64 = typeof fileObj.base64 === 'string' && fileObj.base64.trim() ? fileObj.base64.trim() : null;
                        entries.push({ fileName, filePath, fileObject: null, base64 });
                    });
                }
            } catch (error) {
                logWarn('解析拖拽数据失败:', error);
            }
        }

        if (entries.length === 0) {
            const fileList = Array.from(dataTransfer.files || []);
            fileList.forEach((file: File) => {
                if (!file) return;
                const fpRaw = (file as unknown as Record<string, unknown>).path as string | null;
                const fp = this.normalizeDroppedPath(fpRaw);
                const name = file.name || (fp && fp.split(/[\\\/]/).pop()) || 'untitled';
                entries.push({ fileName: name, filePath: fp, fileObject: file, base64: null });
            });
        }

        if (entries.length === 0) {
            const uriList = typeof dataTransfer.getData === 'function' ? dataTransfer.getData('text/uri-list') || '' : '';
            if (uriList && uriList.trim()) {
                uriList.trim().split(/\r?\n/).forEach((uri) => {
                    if (!uri || uri.startsWith('#')) return;
                    if (!/^file:/i.test(uri)) return;
                    try {
                        const decoded = decodeURIComponent(uri.replace(/^file:\/\//, ''));
                        if (decoded) {
                            entries.push({ fileName: decoded.split(/[\\\/]/).pop() || 'untitled', filePath: decoded, fileObject: null, base64: null });
                        }
                    } catch (_) { }
                });
            }
        }

        // Process each entry via oicppApp.openDroppedFile or electronAPI.readFileContent
        for (const entry of entries) {
            if (entry.filePath) {
                try {
                    const content = await this.readFileContent(entry.filePath);
                    if (content !== null) {
                        this.openFile(entry.fileName, content);
                    }
                } catch (_) { }
            }
        }
        return entries.length > 0;
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const tabManager = new TabManager();
    (window as unknown as { tabManager?: TabManager }).tabManager = tabManager;
});
