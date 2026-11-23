export {};

class SampleTester {
    samples: Array<Record<string, unknown>> = [];
    currentFile: string | null = null;
    samplesFilePath: string | null = null;
    nextId = 1;
    mainCompileCache: { key: string | null; executablePath: string | null } = {
        key: null,
        executablePath: null
    };
    spjCompileCache: { key: string | null; executablePath: string | null } = {
        key: null,
        executablePath: null
    };
    graderCompileCache: { key: string | null; executablePath: string | null } = {
        key: null,
        executablePath: null
    };
    spjTempFiles = new Set<string>();
    spjTempSequence = 0;
    interactiveTempSequence = 0;
    deferSpjTempCleanup = false;
    isRunningAll = false;
    isOperating = false;
    editorChangeInterval: ReturnType<typeof setInterval> | null = null;
    statusFilter: string | null = null;
    globalSettings: Record<string, unknown> = {
        useTestlib: false,
        useInteractive: false,
        spjPath: '',
        graderPath: '',
        freopenInputFile: '',
        freopenOutputFile: '',
        defaultTimeLimit: 1000,
        defaultMemoryLimit: 0
    };
    globalSettingsPanelHeight = this.loadGlobalSettingsPanelHeight();

    constructor() {
        this.setupEventListeners();

        try {
            if (window.electronAPI && window.electronAPI.onSampleTesterCreateProblem) {
                window.electronAPI.onSampleTesterCreateProblem((data: Record<string, unknown>) => {
                    try {
                        logInfo('[样例测试器] 收到外部 createNewProblem:', data?.problemName);
                        if (!data || !Array.isArray(data.samples) || data.samples.length === 0) return;
                        const workspacePath = window.sidebarManager?.panels?.files?.workspacePath;
                        if (!workspacePath) {
                            logWarn('[样例测试器] 未打开工作区，无法创建题目文件');
                            try { window.sidebarManager?.showPanel?.('files'); } catch (_) { }
                            window.alert?.(window.i18n ? window.i18n.t('tester.openWorkspaceFirst') : '请先打开工作区，然后重新发送题目。');
                            return;
                        }
                        const nameRaw = String(data.problemName || '').trim();
                        const fileName = this.buildProblemFileName(nameRaw, String(data.OJ || ''));
                        this.isOperating = true;
                    } catch (error) {
                        logError('[样例测试器] 处理外部问题创建失败:', error);
                    }
                });
            }
        } catch (_) { }
    }

    loadGlobalSettingsPanelHeight(): number {
        try {
            const val = localStorage.getItem('tester.globalSettingsPanelHeight');
            return val ? parseInt(val, 10) || 300 : 300;
        } catch (_) {
            return 300;
        }
    }

    setupEventListeners() {
        // 设置事件监听器
    }

    buildProblemFileName(name: string, oj: string): string {
        return `${oj}-${name}.cpp`;
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
        logInfo(`[样例测试器][${type || 'info'}] ${message}`);
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const sampleTester = new SampleTester();
    (window as { sampleTester?: SampleTester }).sampleTester = sampleTester;
});
