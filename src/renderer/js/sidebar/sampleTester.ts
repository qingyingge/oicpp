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
                        (async () => {
                            try {
                        const targetPath = await ((window.electronAPI as Record<string, unknown>).pathJoin as (a: string, b: string) => Promise<string>)(workspacePath, fileName);
                                let created = false;
                                if (!(await ((window.electronAPI as Record<string, unknown>).checkFileExists as (p: string) => Promise<boolean>)(targetPath))) {
                                    let template = '';
                                    try { const all = await window.electronAPI.getAllSettings(); if (all?.cppTemplate) template = all.cppTemplate + '\n'; } catch (_) { }
                                    if (!template) template = '';
                                    await ((window.electronAPI as Record<string, unknown>).createFile as (p: string, c: string) => Promise<unknown>)(targetPath, template);
                                    created = true;
                                }
                                try {
                                    const content = await window.electronAPI.readFileContent(targetPath);
                                    (window.tabManager as { openFile?: (name: string, content: string, isNew?: boolean, filePath?: string) => void } | undefined)?.openFile?.(fileName, content, false, targetPath);
                                } catch (e) { logWarn('[样例测试器] 打开题目文件失败', e); }
                                const waitEditor = async () => {
                                    const editorMgr = window.editorManager as { currentEditor?: { getFilePath?: () => string | null; filePath?: string | null } } | undefined;
                                    for (let i = 0; i < 20; i++) {
                                        const cur = editorMgr?.currentEditor;
                                        const p = cur?.getFilePath ? cur.getFilePath() : cur?.filePath;
                                        if (p === targetPath) return true;
                                        await new Promise(r => setTimeout(r, 100));
                                    }
                                    return false;
                                };
                                await waitEditor();
                                this.currentFile = targetPath;
                                await this.updateSamplesFilePath();
                                let existing = [];
                                if (this.samplesFilePath && await ((window.electronAPI as Record<string, unknown>).checkFileExists as (p: string) => Promise<boolean>)(this.samplesFilePath)) {
                                    try {
                                        const oldData = JSON.parse(await window.electronAPI.readFileContent(this.samplesFilePath));
                                        existing = Array.isArray(oldData.samples) ? oldData.samples : [];
                                    } catch (_) { }
                                }
                                const samplesArr = Array.isArray((data as Record<string, unknown>).samples) ? (data as Record<string, unknown>).samples : [];
                                const typedSamples = samplesArr as Array<Record<string, unknown>>;
                                const baseId = existing.length;
                                const newSamples = typedSamples.map((s, idx) => ({
                                    id: baseId + idx + 1,
                                    title: `样例 ${baseId + idx + 1}`,
                                    input: s.input || '',
                                    output: s.output || '',
                                    timeLimit: s.timeLimit && Number.isInteger(s.timeLimit) ? s.timeLimit : 1000,
                                    memoryLimit: this.sanitizeMemoryLimit(this.globalSettings.defaultMemoryLimit, 0),
                                    showInput: true,
                                    showOutput: true,
                                    inputType: 'userinput',
                                    outputType: 'userinput',
                                    freopenInputFile: '',
                                    freopenOutputFile: ''
                                }));
                                this.samples = existing.concat(newSamples);
                                this.nextId = this.samples.length + 1;
                                await this.saveSamples();
                                this.updateUI();
                                setTimeout(() => this.expandAllSamples(), 120);
                                try { window.sidebarManager?.showPanel?.('samples'); } catch (_) { }
                                logInfo('[样例测试器] 题目处理完成 文件:', targetPath, '新增样例数:', newSamples.length, '创建新文件:', created);
                            } catch (e) { logError('[样例测试器] 处理外部题目失败', e); }
                            finally {
                                this.isOperating = false;
                            }
                        })();
                    } catch (e) { logError('[样例测试器] 处理外部样例失败(外层)', e); }
                });
            }
        } catch (e) { logWarn('[样例测试器] 注册外部 API 监听失败', e); }
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

    async activate() {
        logInfo('激活样例测试器面板');
        await this.updateCurrentFile();
        await this.loadSamples();
        this.updateUI();

        setTimeout(() => {
            this.expandAllSamples();
        }, 100);
    }

    async refresh() {
        await this.updateCurrentFile();
        await this.loadSamples();
        this.updateUI();
    }

    setupEditorChangeListener() {
        if (this.editorChangeInterval) {
            clearInterval(this.editorChangeInterval);
            logInfo('[样例测试器] 清理旧的编辑器变化监听定时器');
        }

        let lastFilePath = null;
        let lastEditor = null;

        const checkEditorChange = async () => {
            if (this.isOperating) {
                logInfo('[样例测试器] 正在操作中，跳过编辑器变化检查');
                return;
            }

            const editorMgr = window.editorManager as { currentEditor?: { getFilePath?: () => string | null; filePath?: string | null } } | undefined;
            const currentEditor = editorMgr?.currentEditor;

            if (currentEditor === lastEditor) {
                return;
            }

            lastEditor = currentEditor;
            const currentFilePath = currentEditor?.getFilePath ? currentEditor.getFilePath() : currentEditor?.filePath;

            if (currentFilePath === lastFilePath) {
                return;
            }

            this.isOperating = true;

            try {
                lastFilePath = currentFilePath;

                this.samples = [];
                this.samplesFilePath = null;

                // 始终根据当前活动编辑器更新 currentFile / samplesFilePath，
                // 避免样例关联到「上一个文件」。
                await this.updateCurrentFile();

                // 仅在样例面板为活动面板时才刷新 UI，减少不必要的渲染。
                if ((window.sidebarManager as { getCurrentPanel?: () => string } | undefined)?.getCurrentPanel?.() === 'samples') {
                    await this.loadSamples();
                    this.updateUI();

                    setTimeout(() => {
                        if (this.samples.length > 0) {
                            this.expandAllSamples();
                        }
                    }, 100);
                }
            } finally {
                this.isOperating = false;
            }
        };

        this.editorChangeInterval = setInterval(checkEditorChange, 1000);
        logInfo('[样例测试器] 创建新的编辑器变化监听定时器');

        setTimeout(checkEditorChange, 100);
    }

    sanitizeMemoryLimit(value: unknown, fallback: number): number {
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
            return value;
        }
        return fallback;
    }

    buildProblemFileName(nameRaw: string, ojRaw: string): string {
        const normalizedName = this.normalizeProblemFileName(nameRaw);
        if (normalizedName) {
            return normalizedName;
        }
        const ojPart = (ojRaw || 'OJ').replace(/[^A-Za-z0-9]/g, '') || 'OJ';
        const idPart = this.extractProblemIdToken(nameRaw);
        return `${ojPart}_${idPart}.cpp`;
    }

    normalizeProblemFileName(nameRaw: string): string {
        if (!nameRaw || typeof nameRaw !== 'string') {
            return '';
        }

        let cleaned = nameRaw
            .replace(/[\x00-\x1F]/g, '')
            .replace(/[<>:"/\\|?*]/g, '_')
            .replace(/\s+/g, ' ')
            .trim();

        cleaned = cleaned.replace(/[. ]+$/g, '').trim();
        if (!cleaned) {
            return '';
        }

        const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
        // Windows 保留设备名带任何扩展名仍然非法（con.cpp / nul.txt）。
        const stem = cleaned.replace(/\.[^.]*$/, '');
        if (reserved.test(stem)) {
            cleaned = `_${cleaned}`;
        }

        const hasCppExt = /\.(cpp|cc|cxx)$/i.test(cleaned);
        if (!hasCppExt) {
            cleaned = `${cleaned}.cpp`;
        }

        return cleaned;
    }

    extractProblemIdToken(nameRaw: string): string {
        const raw = typeof nameRaw === 'string' ? nameRaw.trim() : '';
        let firstTokenMatch = raw.match(/[A-Za-z0-9_\-]+/);
        let idPart = firstTokenMatch ? firstTokenMatch[0] : raw.replace(/[^A-Za-z0-9_\-]/g, '_');
        if (!idPart) idPart = 'problem';
        if (idPart.length > 32) idPart = idPart.slice(0, 32);
        return idPart;
    }

    // 占位方法，后续批次完善
    async updateCurrentFile(): Promise<void> {
        // 待实现：根据当前活动编辑器更新 currentFile 和 samplesFilePath
    }

    async updateSamplesFilePath(): Promise<void> {
        // 待实现：根据 currentFile 计算 samples 文件路径
    }

    async loadSamples(): Promise<void> {
        // 待实现：加载样例数据
    }

    updateUI(): void {
        // 待实现：更新 UI 显示
    }

    expandAllSamples(): void {
        // 待实现：展开所有样例
    }

    saveSamples(): Promise<void> {
        return Promise.resolve();
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const sampleTester = new SampleTester();
    (window as { sampleTester?: SampleTester }).sampleTester = sampleTester;
});
