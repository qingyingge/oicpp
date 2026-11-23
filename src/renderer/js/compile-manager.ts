export {};

interface CompileResult {
    success: boolean;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    elapsedMs?: number;
}

interface CloudCompileTask {
    id: string;
    status: 'queued' | 'running' | 'completed' | 'failed';
    output?: string;
    progress?: number;
}

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

    private _outputLines: string[] = [];
    private _maxOutputLines = 5000;
    private _currentFilePath: string | null = null;
    private _compileOutputBinary: string | null = null;

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

        const header = document.createElement('div');
        header.className = 'compile-output-header';

        const title = document.createElement('span');
        title.className = 'compile-output-title';
        title.textContent = this.t('compileOutput.title');
        header.appendChild(title);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'compile-output-close';
        closeBtn.textContent = '×';
        closeBtn.onclick = () => this.hideOutput();
        header.appendChild(closeBtn);

        const clearBtn = document.createElement('button');
        clearBtn.className = 'compile-output-clear';
        clearBtn.textContent = this.t('compileOutput.clear');
        clearBtn.onclick = () => this.clearOutput();
        header.appendChild(clearBtn);

        this.compileOutput.appendChild(header);

        const outputArea = document.createElement('div');
        outputArea.className = 'compile-output-area';
        outputArea.id = 'compile-output-text';
        this.compileOutput.appendChild(outputArea);

        const buttonBar = document.createElement('div');
        buttonBar.className = 'compile-output-buttons';

        const copyBtn = document.createElement('button');
        copyBtn.className = 'compile-output-copy';
        copyBtn.textContent = this.t('compileOutput.copy');
        copyBtn.onclick = () => this.copyOutput();
        buttonBar.appendChild(copyBtn);

        this.compileOutput.appendChild(buttonBar);

        document.body.appendChild(this.compileOutput);

        this.analysisList = document.createElement('div');
        this.analysisList.className = 'compile-analysis-list hidden';
        this.compileOutput.appendChild(this.analysisList);

        this.analysisEmptyState = document.createElement('div');
        this.analysisEmptyState.className = 'compile-analysis-empty hidden';
        this.analysisEmptyState.textContent = this.t('compileOutput.analysisEmpty');
        this.compileOutput.appendChild(this.analysisEmptyState);

        this.analysisHint = document.createElement('div');
        this.analysisHint.className = 'compile-analysis-hint hidden';
        this.compileOutput.appendChild(this.analysisHint);
    }

    setupEventListeners() {
        // Wire up menu action buttons for compile/run/debug
        const wireAction = (action: string, handler: () => void) => {
            const el = document.querySelector<HTMLElement>(`[data-action="${action}"]`);
            if (el) {
                el.addEventListener('click', (e) => {
                    e.preventDefault();
                    handler();
                });
            }
        };

        wireAction('compile', () => this.compile());
        wireAction('run', () => this.run());
        wireAction('compile-run', () => this.compileAndRun());
        wireAction('debug', () => this.startDebug());
        wireAction('cloud-compile', () => this.cloudCompile());
        wireAction('open-terminal', () => this.openTerminal());

        // Listen for file changes from editor
        window.addEventListener('oicpp:file-changed', (event: CustomEvent) => {
            const filePath = (event as CustomEvent).detail?.filePath;
            if (filePath) {
                this._currentFilePath = filePath;
            }
        });

        // Listen for compile requests from other modules
        window.addEventListener('oicpp:compile-request', (event: CustomEvent) => {
            const detail = (event as CustomEvent).detail as { filePath?: string; runAfter?: boolean };
            if (detail?.filePath) {
                this._currentFilePath = detail.filePath;
                this.shouldRunAfterCompile = !!detail.runAfter;
                this.compile();
            }
        });
    }

    loadSettings() {
        if (window.electronAPI?.getSettings) {
            window.electronAPI.getSettings().then((settings) => {
                if (settings.compilerPath !== undefined) {
                    this.settings.compilerPath = settings.compilerPath;
                }
                if (settings.compilerArgs !== undefined) {
                    this.settings.compilerArgs = settings.compilerArgs;
                }
                if (settings.runMode !== undefined) {
                    this.settings.runMode = settings.runMode;
                }
                if (settings.workingDirectory !== undefined) {
                    this.settings.workingDirectory = settings.workingDirectory;
                }
                logInfo('编译设置已加载');
            }).catch((error) => {
                logError('加载编译设置失败:', error);
            });
        }
    }

    saveSettings() {
        if (window.electronAPI?.updateSettings) {
            const payload: Record<string, unknown> = {
                compilerPath: this.settings.compilerPath,
                compilerArgs: this.settings.compilerArgs,
                runMode: this.settings.runMode,
                workingDirectory: this.settings.workingDirectory
            };
            window.electronAPI.updateSettings(payload).catch((error) => {
                logError('保存编译设置失败:', error);
            });
        }
    }

    updateAnalysisVisibility() {
        if (!this.analysisList || !this.analysisEmptyState || !this.analysisHint) return;

        if (this.analysisHasContent) {
            this.analysisList.classList.remove('hidden');
            this.analysisEmptyState.classList.add('hidden');
            this.analysisHint.classList.add('hidden');
        } else {
            this.analysisList.classList.add('hidden');
            this.analysisEmptyState.classList.remove('hidden');
            this.analysisHint.classList.remove('hidden');
        }
    }

    async compile(): Promise<CompileResult> {
        if (this.isCompiling) {
            this.showMessage(this.t('compileOutput.compiling'), 'warn');
            return { success: false };
        }

        if (!this._currentFilePath) {
            this.showMessage(this.t('compileOutput.noFile'), 'error');
            return { success: false };
        }

        const compilerPath = String(this.settings.compilerPath || '');
        if (!compilerPath) {
            this.showMessage(this.t('compileOutput.noCompiler'), 'error');
            return { success: false };
        }

        this.isCompiling = true;
        this.clearOutput();
        this.showOutput();
        this.appendOutput(`正在编译: ${this._currentFilePath}\n`);
        this.appendOutput(`编译器: ${compilerPath}\n`);
        this.appendOutput(`参数: ${this.settings.compilerArgs}\n\n`);

        const startTime = Date.now();

        try {
            if (window.electronIPC?.invoke) {
                const result = await window.electronIPC.invoke(
                    'compile-file',
                    this._currentFilePath,
                    String(this.settings.compilerPath),
                    String(this.settings.compilerArgs || ''),
                    String(this.settings.workingDirectory || '')
                ) as CompileResult;

                const elapsed = Date.now() - startTime;
                this.appendOutput(`\n编译完成，耗时: ${elapsed}ms\n`);

                if (result.success) {
                    this.appendOutput(this.t('compileOutput.success'));
                    this.isCompiling = false;
                    if (this.shouldRunAfterCompile) {
                        this.shouldRunAfterCompile = false;
                        this.run();
                    }
                    return { success: true, exitCode: 0, elapsedMs: elapsed };
                } else {
                    this.appendOutput(result.stderr || this.t('compileOutput.failed'));
                    this.isCompiling = false;
                    return { success: false, stderr: result.stderr, exitCode: result.exitCode, elapsedMs: elapsed };
                }
            } else {
                this.appendOutput(this.t('compileOutput.ipcUnavailable'));
                this.isCompiling = false;
                return { success: false };
            }
        } catch (error) {
            const elapsed = Date.now() - startTime;
            this.appendOutput(`\n编译异常: ${error}\n`);
            this.isCompiling = false;
            return { success: false, stderr: String(error), elapsedMs: elapsed };
        }
    }

    async run(): Promise<void> {
        if (this.isRunning) {
            this.showMessage(this.t('compileOutput.running'), 'warn');
            return;
        }

        if (!this._compileOutputBinary) {
            this.showMessage(this.t('compileOutput.noBinary'), 'error');
            return;
        }

        this.isRunning = true;
        this.appendOutput(`\n正在运行: ${this._compileOutputBinary}\n\n`);

        try {
            if (window.electronIPC?.invoke) {
                const result = await window.electronIPC.invoke(
                    'run-file',
                    this._compileOutputBinary,
                    String(this.settings.workingDirectory || '')
                ) as { success?: boolean; stdout?: string; stderr?: string; exitCode?: number };

                if (result.stdout) {
                    this.appendOutput(result.stdout);
                }
                if (result.stderr) {
                    this.appendOutput(result.stderr, 'stderr');
                }
                this.appendOutput(`\n退出码: ${result.exitCode ?? 'unknown'}\n`);
            }
        } catch (error) {
            this.appendOutput(`\n运行异常: ${error}\n`, 'stderr');
        } finally {
            this.isRunning = false;
        }
    }

    async compileAndRun(): Promise<void> {
        const result = await this.compile();
        if (result.success) {
            await this.run();
        }
    }

    async startDebug(): Promise<void> {
        if (!this._currentFilePath) {
            this.showMessage(this.t('compileOutput.noFile'), 'error');
            return;
        }
        this.showMessage(this.t('debug.starting'), 'info');
        // Debug is handled by the debug module; notify via event
        window.dispatchEvent(new CustomEvent('oicpp:debug-request', {
            detail: { filePath: this._currentFilePath }
        }));
    }

    async cloudCompile(): Promise<void> {
        if (this.isCloudCompiling) {
            this.showMessage(this.t('cloudCompile.alreadyRunning'), 'warn');
            return;
        }

        if (!this._currentFilePath) {
            this.showMessage(this.t('compileOutput.noFile'), 'error');
            return;
        }

        this.isCloudCompiling = true;
        this.cloudCompileStartTime = Date.now();
        this.showOutput();
        this.appendOutput(`\n提交云端编译任务...\n`);

        try {
            if (window.electronIPC?.invoke) {
                const result = await window.electronIPC.invoke(
                    'cloud-compile',
                    this._currentFilePath,
                    String(this.settings.compilerArgs || '')
                ) as { success?: boolean; taskId?: string; error?: string };

                if (result.success && result.taskId) {
                    this.cloudCompileTaskId = result.taskId;
                    this.appendOutput(`云端任务已提交: ${result.taskId}\n`);
                    this._startCloudPolling();
                } else {
                    this.appendOutput(`云端编译失败: ${result.error || '未知错误'}\n`, 'stderr');
                    this.isCloudCompiling = false;
                }
            }
        } catch (error) {
            this.appendOutput(`云端编译异常: ${error}\n`, 'stderr');
            this.isCloudCompiling = false;
        }
    }

    private _startCloudPolling(): void {
        if (this.cloudCompilePollTimer) {
            clearInterval(this.cloudCompilePollTimer);
        }
        this.cloudCompilePollTimer = setInterval(async () => {
            if (!this.cloudCompileTaskId) return;
            try {
                if (window.electronIPC?.invoke) {
                    const result = await window.electronIPC.invoke(
                        'cloud-compile-status',
                        this.cloudCompileTaskId
                    ) as { status?: string; output?: string; error?: string };

                    if (result.status === 'completed' || result.status === 'failed') {
                        if (result.output) {
                            this.appendOutput(result.output);
                        }
                        if (result.error) {
                            this.appendOutput(`错误: ${result.error}\n`, 'stderr');
                        }
                        this.isCloudCompiling = false;
                        this.cloudCompileTaskId = null;
                        if (this.cloudCompilePollTimer) {
                            clearInterval(this.cloudCompilePollTimer);
                            this.cloudCompilePollTimer = null;
                        }
                    } else if (result.output) {
                        this.appendOutput(result.output);
                    }
                }
            } catch (error) {
                logError('云端编译轮询失败:', error);
            }
        }, 3000);
    }

    openTerminal(): void {
        window.dispatchEvent(new CustomEvent('oicpp:open-terminal-request'));
    }

    stopCloudCompile(): void {
        if (this.cloudCompilePollTimer) {
            clearInterval(this.cloudCompilePollTimer);
            this.cloudCompilePollTimer = null;
        }
        this.isCloudCompiling = false;
        this.cloudCompileTaskId = null;
    }

    showOutput(): void {
        if (!this.compileOutput) return;
        this.compileOutput.classList.remove('hidden');
    }

    hideOutput(): void {
        if (!this.compileOutput) return;
        this.compileOutput.classList.add('hidden');
    }

    toggleOutput(): void {
        if (!this.compileOutput) return;
        this.compileOutput.classList.toggle('hidden');
    }

    appendOutput(text: string, type?: 'stdout' | 'stderr'): void {
        if (!this.compileOutput) return;
        const outputArea = document.getElementById('compile-output-text');
        if (!outputArea) return;

        const prefix = type === 'stderr' ? '[stderr] ' : '';
        const line = prefix + text;
        this._outputLines.push(line);
        if (this._outputLines.length > this._maxOutputLines) {
            this._outputLines = this._outputLines.slice(-this._maxOutputLines);
        }

        const escaped = line.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        outputArea.innerHTML = this._outputLines.map(l => l.replace(/</g, '&lt;').replace(/>/g, '&gt;')).join('\n');
        outputArea.scrollTop = outputArea.scrollHeight;
    }

    clearOutput(): void {
        this._outputLines = [];
        const outputArea = document.getElementById('compile-output-text');
        if (outputArea) {
            outputArea.innerHTML = '';
        }
    }

    copyOutput(): void {
        const outputArea = document.getElementById('compile-output-text');
        if (!outputArea) return;
        const text = this._outputLines.join('\n');
        if (window.electronAPI?.clipboardWriteText) {
            window.electronAPI.clipboardWriteText(text);
        } else {
            navigator.clipboard.writeText(text).catch(() => {});
        }
    }

    setCurrentFilePath(filePath: string | null): void {
        this._currentFilePath = filePath;
    }

    getCurrentFilePath(): string | null {
        return this._currentFilePath;
    }

    setCompileOutputBinary(path: string | null): void {
        this._compileOutputBinary = path;
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
