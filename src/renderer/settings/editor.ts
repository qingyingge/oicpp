export {};

class EditorSettings {
    settings: Record<string, unknown> = {
        font: 'Consolas, "Courier New", monospace',
        fontSize: 14,
        terminalFontSize: 14,
        syntaxCheckEnabled: true,
        lineHeight: 0,
        theme: 'dark',
        syntaxColorsByTheme: {},
        syntaxFontStyles: {},
        unifiedPreprocessorColor: false,
        tabSize: 4,
        formatterIndentStyle: 'editor',
        wordWrap: false,
        foldingEnabled: true,
        stickyScrollEnabled: true,
        fontLigaturesEnabled: true,
        enableAutoCompletion: true,
        bracketMatching: true,
        highlightCurrentLine: true,
        autoSave: true,
        autoSaveInterval: 60000,
        autoOpenLastWorkspace: true,
        receiveBetaUpdates: false,
        glassEffectEnabled: false,
        markdownMode: 'split',
        keybindings: this.getDefaultKeybindings()
    };

    _initialLoadedSettings: Record<string, unknown> | null = null;
    _saved = false;
    _clangFormatRawDirty = false;
    _clangFormatControlsDirty = false;

    keybindingSchema: Array<{ key: string; label: string; combo: string; macCombo?: string }> = this.getKeybindingSchema();

    constructor() {
        this.init();
    }

    init() {
        // 初始化
    }

    getDefaultKeybindings(): Record<string, string> {
        const isMacPlatform = (() => {
            try {
                const platform = String(window.process?.platform || navigator?.platform || '').toLowerCase();
                return platform.includes('darwin') || platform.includes('mac');
            } catch (_) {
                return false;
            }
        })();

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
            compileAndRun: isMacPlatform ? 'Ctrl+F11' : 'F11',
            toggleDebug: 'F5',
            debugContinue: 'F6',
            debugStepOver: 'F7',
            debugStepInto: 'F8',
            debugStepOut: 'Shift+F8',
            cloudCompile: 'F12',
            openTerminal: 'Ctrl+`',
            runAllSamples: isMacPlatform ? 'Ctrl+Shift+F11' : 'Ctrl+F11'
        };
    }

    getEditableKeybindingKeys(): string[] {
        return [
            'formatCode',
            'showFunctionPicker',
            'markdownPreview',
            'renameSymbol',
            'deleteLine',
            'duplicateLine',
            'moveLineUp',
            'moveLineDown',
            'compileCode',
            'runCode',
            'compileAndRun',
            'toggleDebug',
            'debugContinue',
            'debugStepOver',
            'debugStepInto',
            'debugStepOut',
            'cloudCompile',
            'openTerminal',
            'runAllSamples'
        ];
    }

    getKeybindingSchema(): Array<{ key: string; label: string; combo: string; macCombo?: string }> {
        const bindings = this.getDefaultKeybindings();
        return this.getEditableKeybindingKeys().map((key) => ({
            key,
            label: key,
            combo: bindings[key],
            macCombo: bindings[key]
        }));
    }

    loadSettings() {
        // 加载设置
    }

    saveSettings() {
        if (window.electronAPI && window.electronAPI.updateSettings) {
            window.electronAPI.updateSettings(this.settings).catch((err) => {
                logError('保存编辑器设置失败:', err);
            });
        }
    }

    resetSettings() {
        this.settings = {
            font: 'Consolas, "Courier New", monospace',
            fontSize: 14,
            terminalFontSize: 14,
            syntaxCheckEnabled: true,
            lineHeight: 0,
            theme: 'dark',
            syntaxColorsByTheme: {},
            syntaxFontStyles: {},
            unifiedPreprocessorColor: false,
            tabSize: 4,
            formatterIndentStyle: 'editor',
            wordWrap: false,
            foldingEnabled: true,
            stickyScrollEnabled: true,
            fontLigaturesEnabled: true,
            enableAutoCompletion: true,
            bracketMatching: true,
            highlightCurrentLine: true,
            autoSave: true,
            autoSaveInterval: 60000,
            autoOpenLastWorkspace: true,
            receiveBetaUpdates: false,
            glassEffectEnabled: false,
            markdownMode: 'split',
            keybindings: this.getDefaultKeybindings()
        };
    }

    updateUI() {
        // 更新 UI
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
        logInfo(`[编辑器设置][${type || 'info'}] ${message}`);
    }

    closeWindow() {
        window.close();
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new EditorSettings();
});
