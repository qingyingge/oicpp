export {};

class CodeComparer {
    activeTaskKey: string | null = null;
    standardCodePath = '';
    testCodePath = '';
    generatorPath = '';
    useTestlib = false;
    spjPath = '';
    freopenInputFile = '';
    freopenOutputFile = '';
    maxParallelThreads = 1;
    tasks = new Map<string, unknown>();
    eventsbound = false;

    constructor() {
        this.setupEventListeners();
        this.setupActiveFileListener();
    }

    normalizeTaskKey(taskKey: string | null | undefined): string {
        if (!taskKey || typeof taskKey !== 'string') return '';
        const isWin = typeof window !== 'undefined' && window.process?.platform === 'win32';
        const normalized = String(taskKey).trim();
        if (!isWin) return normalized;
        return normalized.replace(/\//g, '\\').toLowerCase();
    }

    setupActiveFileListener() {
        try {
            window.addEventListener('oicpp:active-file-changed', (e: CustomEvent) => {
                const filePath = e?.detail?.filePath;
                if (!filePath || typeof filePath !== 'string') return;
                if (!this.isSupportedCodeFile(filePath)) return;
                this.setActiveTaskKey(filePath, { syncTestCodePath: true });
            });
        } catch (error) {
            logWarn('[对拍器] 注册活动文件监听失败:', error);
        }
    }

    isSupportedCodeFile(filePath: string): boolean {
        const lower = String(filePath || '').toLowerCase();
        return lower.endsWith('.cpp') || lower.endsWith('.cc') || lower.endsWith('.cxx') || lower.endsWith('.c');
    }

    isPythonGenerator(filePath: string): boolean {
        const lower = String(filePath || '').trim().toLowerCase();
        return lower.endsWith('.py');
    }

    async promptMissingPythonInterpreter(task: Record<string, unknown>) {
        // 提示缺少 Python 解释器
    }

    setupEventListeners() {
        // 设置事件监听器
    }

    setActiveTaskKey(filePath: string, options: Record<string, unknown> = {}) {
        this.activeTaskKey = this.normalizeTaskKey(filePath);
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
        logInfo(`[对拍器][${type || 'info'}] ${message}`);
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const codeComparer = new CodeComparer();
    (window as { codeComparer?: CodeComparer }).codeComparer = codeComparer;
});
