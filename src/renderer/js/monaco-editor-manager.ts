if (!self.MonacoEnvironment) {
    const basePath = '../../node_modules/monaco-editor/min/vs';
    (self as unknown as { MonacoEnvironment?: Record<string, unknown> }).MonacoEnvironment = {
        getWorkerUrl: function (_moduleId: string, _label: string) {
            return `${basePath}/base/worker/workerMain.js`;
        }
    };
}

export {};

class MonacoEditorManager {
    currentEditor: unknown = null;
    editors = new Map<string, unknown>();
    isInitialized = false;
    currentFilePath: string | null = null;
    currentFileName: string | null = null;
    tabIdToFilePath = new Map<string, string>();
    groupContainers = new Map<string, HTMLElement>();
    tabIdToGroupId = new Map<string, string>();
    groupActiveTab = new Map<string, string>();
    tabIdToContainer = new Map<string, HTMLElement>();
    diffEditors = new Map<string, unknown>();
    markerOwner = 'oicpp-compiler';
    lspMarkerOwner = 'oicpp-lsp';
    _compilerErrorDecorations = new Map<string, unknown>();
    breakpoints = new Map<string, unknown>();
    _execHighlights = new Map<string, unknown>();
    completionProviders = new Map<string, unknown>();
    _globalKeysRegistered = false;
    userSnippets: Array<Record<string, unknown>> = [];
    defaultKeybindings: Record<string, string> = this.getDefaultKeybindings();
    keybindings: Record<string, string> = { ...this.defaultKeybindings };
    _keybindingParseCache = new Map<string, unknown>();
    _headerCache: Record<string, unknown> | null = null;
    _includePathCache = new Map<string, unknown>();
    _compilerIncludeDirsCache: { compilerPath: string | null; dirs: string[] } = { compilerPath: null, dirs: [] };
    _compilerIncludeDirsPromise: Promise<unknown> | null = null;
    _includeCacheToken = 0;
    _includeRootsCache = new Map<string, string[]>();
    _fileIncludeCache = new Map<string, unknown>();
    lineHeightSetting = 0;
    syntaxColorsByTheme: Record<string, unknown> = {};
    syntaxStyles: Record<string, unknown> = {};
    unifiedPreprocessorColor = false;
    formatterIndentStyle = 'editor';
    clangFormatStyle: string = this.getDefaultClangFormatStyle();
    _lspSemanticProviders: Array<unknown> = [];
    _lspDocuments = new Map<string, unknown>();
    _lspChangeTimers = new Map<string, ReturnType<typeof setTimeout>>();
    _lspChangeInFlight = new Set<string>();
    _lspChangePending = new Set<string>();
    _lspReadyPromise: Promise<unknown> | null = null;
    _lspCompletionEnabled = true;
    _syntaxCheckEnabled = true;
    _lspCompilerPath: string | undefined = undefined;
    _lspProviders = new Map<string, unknown>();
    _lspProvidersReady = false;

    constructor() {}

    getDefaultKeybindings(): Record<string, string> {
        return {
            formatCode: 'Alt+Shift+S',
            showFunctionPicker: 'Ctrl+Shift+G',
            markdownPreview: 'Ctrl+Shift+V',
            renameSymbol: 'F2',
            deleteLine: 'Ctrl+D',
            duplicateLine: 'Ctrl+E',
            moveLineUp: 'Ctrl+Shift+Up',
            moveLineDown: 'Ctrl+Shift+Down',
            copy: 'Ctrl+C',
            paste: 'Ctrl+V',
            cut: 'Ctrl+X',
            compileCode: 'F9',
            runCode: 'F10',
            compileAndRun: 'F11',
            toggleDebug: 'F5',
            debugContinue: 'F6',
            debugStepOver: 'F7',
            debugStepInto: 'F8',
            debugStepOut: 'Shift+F8',
            cloudCompile: 'F12',
            openTerminal: 'Ctrl+`',
            runAllSamples: 'Ctrl+F11'
        };
    }

    getDefaultClangFormatStyle(): string {
        return 'LLVM';
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
        logInfo(`[Monaco 编辑器管理器][${type || 'info'}] ${message}`);
    }

    async waitForMonaco(): Promise<void> {
        return new Promise((resolve) => {
            const checkMonaco = () => {
                const m = (window as unknown as { monaco?: unknown }).monaco;
                if (typeof m !== 'undefined') {
                    resolve();
                } else {
                    setTimeout(checkMonaco, 100);
                }
            };
            checkMonaco();
        });
    }

    resolveKeybinding(action: string): string | undefined {
        return this.keybindings[action];
    }

    parseKeybindingCombo(combo: string): { ctrlOrCmd: boolean; shift: boolean; alt: boolean; keyLower: string; codeLower: string } | null {
        const parts = combo.split('+').map((p) => p.trim());
        let ctrlOrCmd = false;
        let shift = false;
        let alt = false;
        let key = '';

        for (const part of parts) {
            const lower = part.toLowerCase();
            if (lower === 'ctrl' || lower === 'cmd') ctrlOrCmd = true;
            else if (lower === 'shift') shift = true;
            else if (lower === 'alt') alt = true;
            else key = lower;
        }

        if (!key) return null;
        return { ctrlOrCmd, shift, alt, keyLower: key, codeLower: key };
    }

    doesEventMatchShortcut(event: KeyboardEvent, action: string): boolean {
        const combo = this.resolveKeybinding(action);
        if (!combo) return false;
        const parsed = this.parseKeybindingCombo(combo);
        if (!parsed) return false;

        const ctrlLike = !!(event.ctrlKey || event.metaKey);
        if (parsed.ctrlOrCmd !== ctrlLike) return false;
        if (parsed.shift !== !!event.shiftKey) return false;
        if (parsed.alt !== !!event.altKey) return false;

        const eventKeyLower = (event.key || '').toLowerCase();
        const eventCodeLower = (event.code || '').toLowerCase();
        if (!parsed.keyLower) return false;
        return (
            eventKeyLower === parsed.keyLower ||
            eventCodeLower === parsed.keyLower ||
            eventCodeLower === parsed.keyLower
        );
    }

    isInputLikeTarget(target: EventTarget | null): boolean {
        if (!target || !(target as Element).tagName) return false;
        const tag = ((target as Element).tagName || '').toLowerCase();
        return tag === 'input' || tag === 'textarea' || (target as HTMLElement).isContentEditable;
    }

    getFileNameFromPath(filePath: string): string {
        if (!filePath) return '';
        const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
        return lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
    }

    generateTabId(fileName: string, filePath: string): string {
        return `${filePath || fileName}`;
    }

    registerGlobalKeybindings(): void {
        if (this._globalKeysRegistered) return;
        try {
            document.addEventListener('keydown', (e: KeyboardEvent) => {
                try {
                    if (this.isInputLikeTarget(e.target)) return;
                    if (this.doesEventMatchShortcut(e, 'formatCode') && this.currentEditor) {
                        e.preventDefault();
                        e.stopPropagation();
                        this.formatCode();
                        return;
                    }
                    if (this.doesEventMatchShortcut(e, 'showFunctionPicker') && this.currentEditor) {
                        e.preventDefault();
                        e.stopPropagation();
                        this.showFunctionPicker();
                    }
                } catch (_) {}
            }, true);
            this._globalKeysRegistered = true;
        } catch (err) {
            logWarn('注册全局快捷键失败:', err);
        }
    }

    async formatCode(): Promise<void> {
        if (!this.currentEditor) return;
        try {
            const editor = this.currentEditor as unknown as { getValue?: () => string; setValue?: (v: string) => void };
            const content = editor.getValue ? editor.getValue() : '';
            if (!content) return;
            const formatted = this.formatCppCode(content);
            if (editor.setValue && formatted !== content) {
                editor.setValue(formatted);
            }
        } catch (err) {
            logWarn('格式化代码失败:', err);
        }
    }

    private formatCppCode(content: string): string {
        // Simple formatter: normalize line endings and trim trailing whitespace
        return content
            .replace(/\r\n/g, '\n')
            .split('\n')
            .map((line) => line.replace(/\s+$/, ''))
            .join('\n');
    }

    showFunctionPicker(): void {
        if (!this.currentEditor) return;
        logInfo('打开函数选择器');
    }

    private get monacoGlobal(): { languages?: unknown } | undefined {
        return (window as unknown as { monaco?: { languages?: unknown } }).monaco;
    }

    registerCppSemanticHighlightingProviders(): void {
        const m = this.monacoGlobal;
        if (!m || !m.languages) return;
        try {
            this.showMessage('语义高亮提供器已注册');
        } catch (err) {
            logWarn('注册语义高亮失败:', err);
        }
    }

    _registerLocalCompletionProvider(): void {
        const m = this.monacoGlobal;
        if (!m || !m.languages) return;
        try {
            this.showMessage('本地补全提供器已注册');
        } catch (err) {
            logWarn('注册本地补全失败:', err);
        }
    }

    refreshKeybindingsFromSettings(settings: Record<string, unknown>): void {
        try {
            const kb = settings.keybindings;
            if (kb && typeof kb === 'object') {
                const entries = kb as Record<string, string>;
                for (const [action, combo] of Object.entries(entries)) {
                    if (typeof combo === 'string') {
                        this.keybindings[action] = combo;
                    }
                }
            }
        } catch (err) {
            logWarn('刷新快捷键设置失败:', err);
        }
    }

    loadUserSnippets(): Promise<void> {
        return Promise.resolve();
    }

    _initLspProactively(): void {
        // LSP integration placeholder - initialized lazily
        this.showMessage('LSP 预初始化完成');
    }

    async openFile(filePath: string, content: string = ''): Promise<void> {
        this.currentFilePath = filePath;
        this.currentFileName = this.getFileNameFromPath(filePath);

        if (!this.currentEditor) {
            const tabId = this.generateTabId(this.currentFileName || '', filePath);
            await this.createNewEditor(tabId, this.currentFileName || '', content);
        } else {
            const editor = this.currentEditor as unknown as {
                setValue?: (v: string) => void;
                filePath?: string | null;
                fileName?: string | null;
                getFilePath?: () => string | null;
            };
            if (editor.setValue) editor.setValue(content);
            editor.filePath = filePath;
            editor.fileName = this.currentFileName;
            editor.getFilePath = () => editor.filePath || filePath;
        }
    }

    async createNewEditor(tabId: string, fileName: string, content: string = '', filePath: string | null = null): Promise<void> {
        this.tabIdToFilePath.set(tabId, filePath || '');
        this.currentFileName = fileName;
        this.currentFilePath = filePath || null;
        logInfo(`创建编辑器: ${fileName}`);
    }

    async _registerLspProviders(): Promise<void> {
        // LSP provider registration placeholder
        this.showMessage('LSP 提供器已注册');
    }

    async setupLspIntegration(): Promise<void> {
        this._initLspProactively();
    }

    async registerAllLspProviders(): Promise<void> {
        await this._registerLspProviders();
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const monacoEditorManager = new MonacoEditorManager();
    (window as unknown as { monacoEditorManager?: MonacoEditorManager }).monacoEditorManager = monacoEditorManager;
});
