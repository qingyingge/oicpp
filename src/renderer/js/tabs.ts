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

    normalizePathSlashes(pathCandidate: string): string {
        return pathCandidate.replace(/\\/g, '/');
    }

    isLikelyFileObject(candidate: unknown): candidate is File {
        return candidate !== null && typeof candidate === 'object' && 'name' in (candidate as Record<string, unknown>);
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
}

window.addEventListener('DOMContentLoaded', () => {
    const tabManager = new TabManager();
    (window as unknown as { tabManager?: TabManager }).tabManager = tabManager;
});
