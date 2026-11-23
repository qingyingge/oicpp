export {};

class CompilerManager {
    t(key: string, params?: Record<string, unknown>, fallback?: string): string {
        return window.i18n?.t?.(key, params) || fallback || key;
    }

    settings: Record<string, unknown> = {
        compilerPath: '',
        compilerArgs: '-std=c++14 -O2 -static',
        runMode: 'popup',
        workingDirectory: ''
    };

    isCompiling = false;
    isRunning = false;
    compileOutput: HTMLElement | null = null;
    shouldRunAfterCompile = false;
    isCloudCompiling = false;
    cloudCompileTaskId: string | null = null;
    cloudCompilePollTimer: ReturnType<typeof setInterval> | null = null;
    cloudCompileAbortController: AbortController | null = null;
    cloudProgressLine: HTMLElement | null = null;
    cloudQueueLastCount: number | null = null;
    cloudCompileStartTime: number | null = null;
    cloudCompileRunId = 0;
    analysisList: HTMLElement | null = null;
    analysisEmptyState: HTMLElement | null = null;
    activePane = 'raw';
    analysisHasContent = false;
    tabButtons: Array<HTMLElement> = [];
    analysisHint: HTMLElement | null = null;
    analysisAvailable = false;

    constructor() {
        if (window.i18n?.onChange) {
            window.i18n.onChange(() => {
                if (!this.compileOutput) return;
                this.updateAnalysisVisibility();
            });
        }
    }

    init() {
        logInfo('编译管理器初始化...');
        this.createCompileOutputWindow();
        this.setupEventListeners();
        this.loadSettings();
    }

    createCompileOutputWindow() {
        const existingWindow = document.querySelector<HTMLElement>('.compile-output-window');
        if (existingWindow) {
            existingWindow.remove();
        }

        this.compileOutput = document.createElement('div');
        this.compileOutput.className = 'compile-output-window hidden';
        this.compileOutput.id = 'compile-output-panel';
        document.body.appendChild(this.compileOutput);
    }

    setupEventListeners() {
        // 设置事件监听器
    }

    loadSettings() {
        // 加载设置
    }

    updateAnalysisVisibility() {
        // 更新分析可见性
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
        logInfo(`[编译管理器][${type || 'info'}] ${message}`);
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const compilerManager = new CompilerManager();
    (window as { compilerManager?: CompilerManager }).compilerManager = compilerManager;
});
