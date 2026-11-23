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
}

window.addEventListener('DOMContentLoaded', () => {
    const monacoEditorManager = new MonacoEditorManager();
    (window as unknown as { monacoEditorManager?: MonacoEditorManager }).monacoEditorManager = monacoEditorManager;
});
