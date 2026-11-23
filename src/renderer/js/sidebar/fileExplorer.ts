export {};

class FileExplorer {
    currentPath = '';
    files: Array<Record<string, unknown>> = [];
    selectedFile: string | null = null;
    selectedFiles = new Map<string, unknown>();
    hasWorkspace = false;
    clipboard: Record<string, unknown> | null = null;
    expandedFolders = new Set<string>();
    _directoryReadRequests = new Map<string, unknown>();
    _treeItemsByPath = new Map<string, HTMLElement>();
    _draggingItems = new Set<string>();
    _dragOverItem: HTMLElement | null = null;
    _pendingDragOverTarget: HTMLElement | null = null;
    _pendingDragOverRoot = false;
    _dragHoverFrame: ReturnType<typeof requestAnimationFrame> | null = null;
    isDragging = false;

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
        // 设置键盘快捷键
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
}

window.addEventListener('DOMContentLoaded', () => {
    const fileExplorer = new FileExplorer();
    (window as { fileExplorer?: FileExplorer }).fileExplorer = fileExplorer;
});
