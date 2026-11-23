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
        const t = (key: string, params?: Record<string, unknown>) => {
            if (window.i18n && typeof window.i18n.t === 'function') {
                return window.i18n.t(key, params);
            }
            return key;
        };

        const $ = (id: string): HTMLElement | null => document.getElementById(id);
        const setProp = (id: string, prop: string, value: unknown) => {
            const el = $(id);
            if (el) {
                (el as unknown as Record<string, unknown>)[prop] = value;
            }
        };
        const setChecked = (id: string, value: boolean) => {
            const el = $(id) as HTMLInputElement | null;
            if (el) el.checked = value;
        };
        const setValue = (id: string, value: unknown) => {
            const el = $(id) as HTMLInputElement | null;
            if (el) el.value = String(value ?? '');
        };

        // Syntax color rows: each row has color input, text input, bold checkbox, italic checkbox
        const syntaxRows = [
            { key: 'keyword', id: 'keyword' },
            { key: 'string', id: 'string' },
            { key: 'comment', id: 'comment' },
            { key: 'number', id: 'number' },
            { key: 'operator', id: 'operator' },
            { key: 'punctuation', id: 'punctuation' },
            { key: 'pointer', id: 'pointer' },
            { key: 'variable', id: 'variable' }
        ];

        // Load settings
        this.loadSettings();

        // Initialize UI from settings
        this.updateUI();

        // Wire up general tab controls
        const langSelect = $(`editor-language`) as HTMLSelectElement | null;
        if (langSelect) {
            langSelect.value = String(this.settings.language || 'zh-cn');
            langSelect.addEventListener('change', () => {
                this.settings.language = langSelect.value;
            });
        }

        const fontSelect = $(`editor-font`) as HTMLSelectElement | null;
        if (fontSelect) {
            fontSelect.value = String(this.settings.font || '');
            fontSelect.addEventListener('change', () => {
                this.settings.font = fontSelect.value;
            });
        }

        setValue('editor-font-size', this.settings.fontSize ?? 14);
        const fontSizeInput = $(`editor-font-size`) as HTMLInputElement | null;
        if (fontSizeInput) {
            fontSizeInput.addEventListener('input', () => {
                this.settings.fontSize = parseInt(fontSizeInput.value, 10) || 14;
            });
        }

        setValue('editor-terminal-font-size', this.settings.terminalFontSize ?? 14);
        const terminalFontSizeInput = $(`editor-terminal-font-size`) as HTMLInputElement | null;
        if (terminalFontSizeInput) {
            terminalFontSizeInput.addEventListener('input', () => {
                this.settings.terminalFontSize = parseInt(terminalFontSizeInput.value, 10) || 14;
            });
        }

        setValue('editor-terminal-startup-command', this.settings.terminalStartupCommand ?? '');
        const terminalCmdInput = $(`editor-terminal-startup-command`) as HTMLInputElement | null;
        if (terminalCmdInput) {
            terminalCmdInput.addEventListener('input', () => {
                this.settings.terminalStartupCommand = terminalCmdInput.value;
            });
        }

        setValue('editor-line-height', this.settings.lineHeight ?? '');
        const lineHeightInput = $(`editor-line-height`) as HTMLInputElement | null;
        if (lineHeightInput) {
            lineHeightInput.addEventListener('input', () => {
                this.settings.lineHeight = lineHeightInput.value === '' ? 0 : parseInt(lineHeightInput.value, 10) || 0;
            });
        }

        setValue('editor-tab-size', this.settings.tabSize ?? 4);
        const tabSizeInput = $(`editor-tab-size`) as HTMLInputElement | null;
        if (tabSizeInput) {
            tabSizeInput.addEventListener('input', () => {
                this.settings.tabSize = parseInt(tabSizeInput.value, 10) || 4;
            });
        }

        // Appearance tab
        const themeSelect = $(`editor-theme`) as HTMLSelectElement | null;
        if (themeSelect) {
            themeSelect.value = String(this.settings.theme || 'dark');
            themeSelect.addEventListener('change', () => {
                this.settings.theme = themeSelect.value;
            });
        }

        setValue('editor-opacity', this.settings.windowOpacity ?? 0);
        const opacityInput = $(`editor-opacity`) as HTMLInputElement | null;
        const opacityValue = $(`editor-opacity-value`) as HTMLSpanElement | null;
        if (opacityInput) {
            opacityInput.addEventListener('input', () => {
                const val = opacityInput.value;
                setValue('editor-opacity-value', `${Math.round(parseFloat(val) * 100)}%`);
                this.settings.windowOpacity = parseFloat(val);
            });
        }

        setChecked('editor-glass-effect-enabled', Boolean(this.settings.glassEffectEnabled));
        const glassCheckbox = $(`editor-glass-effect-enabled`) as HTMLInputElement | null;
        if (glassCheckbox) {
            glassCheckbox.addEventListener('change', () => {
                this.settings.glassEffectEnabled = glassCheckbox.checked;
            });
        }

        setValue('editor-bg-image', this.settings.bgImagePath ?? '');
        const bgImageInput = $(`editor-bg-image`) as HTMLInputElement | null;
        if (bgImageInput) {
            bgImageInput.addEventListener('input', () => {
                this.settings.bgImagePath = bgImageInput.value;
            });
        }

        const browseBgBtn = $(`browse-bg-image`) as HTMLButtonElement | null;
        if (browseBgBtn) {
            browseBgBtn.addEventListener('click', async () => {
                try {
                    const result = await window.electronAPI?.openFileDialog?.({
                        title: t('settings.selectBgImage'),
                        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif'] }]
                    });
                    if (result && !result.canceled && result.filePaths && result.filePaths[0]) {
                        this.settings.bgImagePath = result.filePaths[0];
                        setValue('editor-bg-image', this.settings.bgImagePath);
                    }
                } catch (_) {
                    // dialog not available, ignore
                }
            });
        }

        const clearBgBtn = $(`clear-bg-image`) as HTMLButtonElement | null;
        if (clearBgBtn) {
            clearBgBtn.addEventListener('click', () => {
                this.settings.bgImagePath = '';
                setValue('editor-bg-image', '');
            });
        }

        setChecked('editor-font-ligatures', Boolean(this.settings.fontLigaturesEnabled));
        const ligaturesCheckbox = $(`editor-font-ligatures`) as HTMLInputElement | null;
        if (ligaturesCheckbox) {
            ligaturesCheckbox.addEventListener('change', () => {
                this.settings.fontLigaturesEnabled = ligaturesCheckbox.checked;
            });
        }

        // Syntax colors
        for (const row of syntaxRows) {
            const colorKey = `syntax-color-${row.id}`;
            const textKey = `syntax-color-${row.id}-text`;
            const boldKey = `syntax-style-${row.id}-bold`;
            const italicKey = `syntax-style-${row.id}-italic`;

            const colors = (this.settings.syntaxColorsByTheme as Record<string, Record<string, string>>) ?? {};
            const theme = String(this.settings.theme || 'dark');
            const currentColor = (colors[theme]?.[row.key] ?? '#000000');

            const colorInput = $(colorKey) as HTMLInputElement | null;
            const textInput = $(textKey) as HTMLInputElement | null;
            if (colorInput) {
                colorInput.value = currentColor;
                colorInput.addEventListener('input', () => {
                    if (!colors[theme]) colors[theme] = {};
                    colors[theme][row.key] = colorInput.value;
                    setValue(textKey, colorInput.value);
                    this.settings.syntaxColorsByTheme = colors;
                });
            }
            if (textInput) {
                textInput.value = currentColor;
                textInput.addEventListener('input', () => {
                    if (!colors[theme]) colors[theme] = {};
                    colors[theme][row.key] = textInput.value;
                    if (colorInput) colorInput.value = textInput.value;
                    this.settings.syntaxColorsByTheme = colors;
                });
            }

            const styles = (this.settings.syntaxFontStyles as Record<string, Record<string, { bold?: boolean; italic?: boolean }>>) ?? {};
            const currentStyle = (styles[theme]?.[row.key] ?? { bold: false, italic: false });

            const boldInput = $(boldKey) as HTMLInputElement | null;
            const italicInput = $(italicKey) as HTMLInputElement | null;
            if (boldInput) {
                boldInput.checked = Boolean(currentStyle.bold);
                boldInput.addEventListener('change', () => {
                    if (!styles[theme]) styles[theme] = {};
                    if (!styles[theme][row.key]) styles[theme][row.key] = {};
                    styles[theme][row.key].bold = boldInput.checked;
                    this.settings.syntaxFontStyles = styles;
                });
            }
            if (italicInput) {
                italicInput.checked = Boolean(currentStyle.italic);
                italicInput.addEventListener('change', () => {
                    if (!styles[theme]) styles[theme] = {};
                    if (!styles[theme][row.key]) styles[theme][row.key] = {};
                    styles[theme][row.key].italic = italicInput.checked;
                    this.settings.syntaxFontStyles = styles;
                });
            }
        }

        const resetSyntaxBtn = $(`reset-syntax-colors`) as HTMLButtonElement | null;
        if (resetSyntaxBtn) {
            resetSyntaxBtn.addEventListener('click', () => {
                this.settings.syntaxColorsByTheme = this.getDefaultSyntaxColors();
                this.settings.syntaxFontStyles = this.getDefaultSyntaxFontStyles();
                this.updateUI();
            });
        }

        setChecked('editor-unified-preprocessor-color', Boolean(this.settings.unifiedPreprocessorColor));
        const unifiedCheckbox = $(`editor-unified-preprocessor-color`) as HTMLInputElement | null;
        if (unifiedCheckbox) {
            unifiedCheckbox.addEventListener('change', () => {
                this.settings.unifiedPreprocessorColor = unifiedCheckbox.checked;
            });
        }

        // Behavior tab
        setChecked('editor-folding', Boolean(this.settings.foldingEnabled));
        const foldingCheckbox = $(`editor-folding`) as HTMLInputElement | null;
        if (foldingCheckbox) {
            foldingCheckbox.addEventListener('change', () => {
                this.settings.foldingEnabled = foldingCheckbox.checked;
            });
        }

        setChecked('editor-sticky-scroll', Boolean(this.settings.stickyScrollEnabled));
        const stickyCheckbox = $(`editor-sticky-scroll`) as HTMLInputElement | null;
        if (stickyCheckbox) {
            stickyCheckbox.addEventListener('change', () => {
                this.settings.stickyScrollEnabled = stickyCheckbox.checked;
            });
        }

        setChecked('editor-auto-completion', Boolean(this.settings.enableAutoCompletion));
        const autocompleteCheckbox = $(`editor-auto-completion`) as HTMLInputElement | null;
        if (autocompleteCheckbox) {
            autocompleteCheckbox.addEventListener('change', () => {
                this.settings.enableAutoCompletion = autocompleteCheckbox.checked;
            });
        }

        setChecked('editor-syntax-check-enabled', Boolean(this.settings.syntaxCheckEnabled));
        const syntaxCheckCheckbox = $(`editor-syntax-check-enabled`) as HTMLInputElement | null;
        if (syntaxCheckCheckbox) {
            syntaxCheckCheckbox.addEventListener('change', () => {
                this.settings.syntaxCheckEnabled = syntaxCheckCheckbox.checked;
            });
        }

        setChecked('editor-auto-save-enabled', Boolean(this.settings.autoSave));
        const autoSaveCheckbox = $(`editor-auto-save-enabled`) as HTMLInputElement | null;
        if (autoSaveCheckbox) {
            autoSaveCheckbox.addEventListener('change', () => {
                this.settings.autoSave = autoSaveCheckbox.checked;
            });
        }

        setValue('editor-auto-save-interval', this.settings.autoSaveInterval ?? 60000);
        const autoSaveIntervalInput = $(`editor-auto-save-interval`) as HTMLInputElement | null;
        if (autoSaveIntervalInput) {
            autoSaveIntervalInput.addEventListener('input', () => {
                this.settings.autoSaveInterval = parseInt(autoSaveIntervalInput.value, 10) || 60000;
            });
        }

        setChecked('editor-auto-open-last-workspace', Boolean(this.settings.autoOpenLastWorkspace));
        const autoOpenCheckbox = $(`editor-auto-open-last-workspace`) as HTMLInputElement | null;
        if (autoOpenCheckbox) {
            autoOpenCheckbox.addEventListener('change', () => {
                this.settings.autoOpenLastWorkspace = autoOpenCheckbox.checked;
            });
        }

        setChecked('editor-receive-beta-updates', Boolean(this.settings.receiveBetaUpdates));
        const betaCheckbox = $(`editor-receive-beta-updates`) as HTMLInputElement | null;
        if (betaCheckbox) {
            betaCheckbox.addEventListener('change', () => {
                this.settings.receiveBetaUpdates = betaCheckbox.checked;
            });
        }

        // Formatting tab - clang-format controls
        const clangFormatKeys: Array<{ id: string; settingKey: string }> = [
            { id: 'clang-format-based-on-style', settingKey: 'clangFormatBasedOnStyle' },
            { id: 'clang-format-use-tab', settingKey: 'clangFormatUseTab' },
            { id: 'clang-format-indent-width', settingKey: 'clangFormatIndentWidth' },
            { id: 'clang-format-tab-width', settingKey: 'clangFormatTabWidth' },
            { id: 'clang-format-column-limit', settingKey: 'clangFormatColumnLimit' },
            { id: 'clang-format-break-before-braces', settingKey: 'clangFormatBreakBeforeBraces' },
            { id: 'clang-format-pointer-alignment', settingKey: 'clangFormatPointerAlignment' },
            { id: 'clang-format-space-before-parens', settingKey: 'clangFormatSpaceBeforeParens' }
        ];

        for (const { id, settingKey } of clangFormatKeys) {
            const el = $(id);
            if (!el) continue;
            const currentVal = this.settings[settingKey];
            if (el.tagName === 'SELECT') {
                (el as HTMLSelectElement).value = String(currentVal ?? '');
                el.addEventListener('change', () => {
                    this.settings[settingKey] = (el as HTMLSelectElement).value;
                });
            } else if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'number') {
                setValue(id, currentVal ?? 0);
                el.addEventListener('input', () => {
                    this.settings[settingKey] = parseInt((el as HTMLInputElement).value, 10) || 0;
                });
            } else if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'checkbox') {
                setChecked(id, Boolean(currentVal));
                el.addEventListener('change', () => {
                    this.settings[settingKey] = ($(id) as HTMLInputElement).checked;
                });
            }
        }

        setChecked('clang-format-indent-case-labels', Boolean(this.settings.clangFormatIndentCaseLabels));
        setChecked('clang-format-sort-includes', Boolean(this.settings.clangFormatSortIncludes));
        setChecked('clang-format-align-assignments', Boolean(this.settings.clangFormatAlignAssignments));
        setChecked('clang-format-align-declarations', Boolean(this.settings.clangFormatAlignDeclarations));

        const rawTextArea = $(`clang-format-raw-text`) as HTMLTextAreaElement | null;
        if (rawTextArea) {
            rawTextArea.value = String(this.settings.clangFormatRawText ?? '');
            rawTextArea.addEventListener('input', () => {
                this.settings.clangFormatRawText = rawTextArea.value;
                this._clangFormatRawDirty = true;
            });
        }

        const importBtn = $(`import-clang-format`) as HTMLButtonElement | null;
        if (importBtn) {
            importBtn.addEventListener('click', async () => {
                try {
                    const result = await window.electronAPI?.openFileDialog?.({
                        title: t('settings.importClangFormat'),
                        filters: [{ name: 'Clang-Format', extensions: ['clang-format', ''] }]
                    });
                    if (result && !result.canceled && result.filePaths && result.filePaths[0]) {
                        // content would be read via electronAPI, placeholder
                        const content = await window.electronAPI?.readFile?.(result.filePaths[0]);
                        if (typeof content === 'string') {
                            this.settings.clangFormatRawText = content;
                            if (rawTextArea) rawTextArea.value = content;
                            this._clangFormatRawDirty = true;
                        }
                    }
                } catch (_) {
                    // ignore
                }
            });
        }

        const applyTextBtn = $(`apply-clang-format-text`) as HTMLButtonElement | null;
        if (applyTextBtn) {
            applyTextBtn.addEventListener('click', () => {
                // Apply raw text to detailed controls (placeholder - would parse clang-format)
                this._clangFormatRawDirty = false;
                this.showMessage(t('settings.clangFormatApplied'));
            });
        }

        const saveFileBtn = $(`save-clang-format-file`) as HTMLButtonElement | null;
        if (saveFileBtn) {
            saveFileBtn.addEventListener('click', async () => {
                try {
                    const result = await window.electronAPI?.saveFileDialog?.({
                        title: t('settings.saveClangFormat'),
                        defaultPath: '.clang-format'
                    });
                    if (result && !result.canceled && result.filePath) {
                        await window.electronAPI?.writeFile?.(result.filePath, String(this.settings.clangFormatRawText ?? ''));
                        this.showMessage(t('settings.clangFormatSaved'));
                    }
                } catch (_) {
                    // ignore
                }
            });
        }

        const resetClangBtn = $(`reset-clang-format`) as HTMLButtonElement | null;
        if (resetClangBtn) {
            resetClangBtn.addEventListener('click', () => {
                this.settings.clangFormatRawText = '';
                this.settings.clangFormatBasedOnStyle = 'LLVM';
                this.settings.clangFormatUseTab = 'ForIndentation';
                this.settings.clangFormatIndentWidth = 4;
                this.settings.clangFormatTabWidth = 4;
                this.settings.clangFormatColumnLimit = 0;
                if (rawTextArea) rawTextArea.value = '';
                this.updateUI();
            });
        }

        // Keybindings tab
        const keybindingsList = $(`keybindings-list`) as HTMLDivElement | null;
        if (keybindingsList) {
            this.renderKeybindings(keybindingsList);
        }

        const resetKeybindingsBtn = $(`reset-keybindings`) as HTMLButtonElement | null;
        if (resetKeybindingsBtn) {
            resetKeybindingsBtn.addEventListener('click', () => {
                this.settings.keybindings = this.getDefaultKeybindings();
                const list = $(`keybindings-list`) as HTMLDivElement | null;
                if (list) this.renderKeybindings(list);
            });
        }

        // Global actions
        const saveBtn = $(`save-settings`) as HTMLButtonElement | null;
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                this.saveSettings();
                this.showMessage(t('settings.saved'));
            });
        }

        const cancelBtn = $(`cancel-settings`) as HTMLButtonElement | null;
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                this.closeWindow();
            });
        }

        const resetBtn = $(`reset-settings`) as HTMLButtonElement | null;
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this.resetSettings();
                this.updateUI();
                this.showMessage(t('settings.reset'));
            });
        }

        // Font download dialog
        const fontDialog = $(`font-download-dialog`) as HTMLDivElement | null;
        const closeFontBtn = $(`close-font-dialog`) as HTMLButtonElement | null;
        if (closeFontBtn && fontDialog) {
            closeFontBtn.addEventListener('click', () => {
                fontDialog.style.display = 'none';
            });
        }

        // Close font dialog when clicking outside
        if (fontDialog) {
            fontDialog.addEventListener('click', (e) => {
                if (e.target === fontDialog) fontDialog.style.display = 'none';
            });
        }

        // Re-apply i18n to static elements
        if (window.i18n && typeof window.i18n._applyToDOM === 'function') {
            window.i18n._applyToDOM();
        }
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
        if (window.electronAPI && window.electronAPI.getSettings) {
            window.electronAPI.getSettings().then((loaded: Record<string, unknown>) => {
                this.settings = { ...this.settings, ...loaded };
                this.updateUI();
            }).catch((err) => {
                logError('加载编辑器设置失败:', err);
            });
        }
    }

    saveSettings() {
        const payload: Record<string, unknown> = {
            ...this.settings,
            keybindings: this.settings.keybindings
        };
        if (window.electronAPI && window.electronAPI.updateSettings) {
            window.electronAPI.updateSettings(payload).catch((err) => {
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
            keybindings: this.getDefaultKeybindings(),
            language: 'zh-cn',
            terminalStartupCommand: '',
            bgImagePath: '',
            clangFormatRawText: '',
            clangFormatBasedOnStyle: 'LLVM',
            clangFormatUseTab: 'ForIndentation',
            clangFormatIndentWidth: 4,
            clangFormatTabWidth: 4,
            clangFormatColumnLimit: 0,
            clangFormatIndentCaseLabels: false,
            clangFormatSortIncludes: true,
            clangFormatAlignAssignments: false,
            clangFormatAlignDeclarations: false
        };
    }

    updateUI() {
        const setProp = (id: string, prop: string, value: unknown) => {
            const el = document.getElementById(id);
            if (el) {
                (el as unknown as Record<string, unknown>)[prop] = value;
            }
        };
        const setChecked = (id: string, value: boolean) => {
            const el = document.getElementById(id) as HTMLInputElement | null;
            if (el) el.checked = value;
        };
        const setValue = (id: string, value: unknown) => {
            const el = document.getElementById(id) as HTMLInputElement | null;
            if (el) el.value = String(value ?? '');
        };

        // General
        const langSelect = document.getElementById('editor-language') as HTMLSelectElement | null;
        if (langSelect) langSelect.value = String(this.settings.language || 'zh-cn');

        const fontSelect = document.getElementById('editor-font') as HTMLSelectElement | null;
        if (fontSelect) fontSelect.value = String(this.settings.font || '');

        setValue('editor-font-size', this.settings.fontSize ?? 14);
        setValue('editor-terminal-font-size', this.settings.terminalFontSize ?? 14);
        setValue('editor-terminal-startup-command', this.settings.terminalStartupCommand ?? '');
        setValue('editor-line-height', this.settings.lineHeight ?? '');
        setValue('editor-tab-size', this.settings.tabSize ?? 4);

        // Appearance
        const themeSelect = document.getElementById('editor-theme') as HTMLSelectElement | null;
        if (themeSelect) themeSelect.value = String(this.settings.theme || 'dark');

        setValue('editor-opacity', this.settings.windowOpacity ?? 0);
        const opacityInput = document.getElementById('editor-opacity') as HTMLInputElement | null;
        const opacityValue = document.getElementById('editor-opacity-value') as HTMLSpanElement | null;
        if (opacityInput && opacityValue) {
            opacityValue.textContent = `${Math.round(parseFloat(String(opacityInput.value || 0)) * 100)}%`;
        }

        setChecked('editor-glass-effect-enabled', Boolean(this.settings.glassEffectEnabled));
        setValue('editor-bg-image', this.settings.bgImagePath ?? '');
        setChecked('editor-font-ligatures', Boolean(this.settings.fontLigaturesEnabled));

        // Syntax colors
        const syntaxRows = ['keyword', 'string', 'comment', 'number', 'operator', 'punctuation', 'pointer', 'variable'];
        const colors = (this.settings.syntaxColorsByTheme as Record<string, Record<string, string>>) ?? {};
        const styles = (this.settings.syntaxFontStyles as Record<string, Record<string, { bold?: boolean; italic?: boolean }>>) ?? {};
        const theme = String(this.settings.theme || 'dark');

        for (const rowKey of syntaxRows) {
            const colorInput = document.getElementById(`syntax-color-${rowKey}`) as HTMLInputElement | null;
            const textInput = document.getElementById(`syntax-color-${rowKey}-text`) as HTMLInputElement | null;
            const boldInput = document.getElementById(`syntax-style-${rowKey}-bold`) as HTMLInputElement | null;
            const italicInput = document.getElementById(`syntax-style-${rowKey}-italic`) as HTMLInputElement | null;

            const currentColor = (colors[theme]?.[rowKey] ?? '#000000');
            if (colorInput) colorInput.value = currentColor;
            if (textInput) textInput.value = currentColor;

            const currentStyle = (styles[theme]?.[rowKey] ?? { bold: false, italic: false });
            if (boldInput) boldInput.checked = Boolean(currentStyle.bold);
            if (italicInput) italicInput.checked = Boolean(currentStyle.italic);
        }

        setChecked('editor-unified-preprocessor-color', Boolean(this.settings.unifiedPreprocessorColor));

        // Behavior
        setChecked('editor-folding', Boolean(this.settings.foldingEnabled));
        setChecked('editor-sticky-scroll', Boolean(this.settings.stickyScrollEnabled));
        setChecked('editor-auto-completion', Boolean(this.settings.enableAutoCompletion));
        setChecked('editor-syntax-check-enabled', Boolean(this.settings.syntaxCheckEnabled));
        setChecked('editor-auto-save-enabled', Boolean(this.settings.autoSave));
        setValue('editor-auto-save-interval', this.settings.autoSaveInterval ?? 60000);
        setChecked('editor-auto-open-last-workspace', Boolean(this.settings.autoOpenLastWorkspace));
        setChecked('editor-receive-beta-updates', Boolean(this.settings.receiveBetaUpdates));

        // Formatting
        setValue('clang-format-indent-width', this.settings.clangFormatIndentWidth ?? 4);
        setValue('clang-format-tab-width', this.settings.clangFormatTabWidth ?? 4);
        setValue('clang-format-column-limit', this.settings.clangFormatColumnLimit ?? 0);
        setChecked('clang-format-indent-case-labels', Boolean(this.settings.clangFormatIndentCaseLabels));
        setChecked('clang-format-sort-includes', Boolean(this.settings.clangFormatSortIncludes));
        setChecked('clang-format-align-assignments', Boolean(this.settings.clangFormatAlignAssignments));
        setChecked('clang-format-align-declarations', Boolean(this.settings.clangFormatAlignDeclarations));

        const rawTextArea = document.getElementById('clang-format-raw-text') as HTMLTextAreaElement | null;
        if (rawTextArea) {
            rawTextArea.value = String(this.settings.clangFormatRawText ?? '');
        }

        // Keybindings
        const keybindingsList = document.getElementById('keybindings-list') as HTMLDivElement | null;
        if (keybindingsList) {
            this.renderKeybindings(keybindingsList);
        }
    }

    getDefaultSyntaxColors(): Record<string, Record<string, string>> {
        const defaults: Record<string, string> = {
            keyword: '#c586c0',
            string: '#ce9178',
            comment: '#6a9955',
            number: '#b5cea8',
            operator: '#d4d4d4',
            punctuation: '#d4d4d4',
            pointer: '#d4d4d4',
            variable: '#9cdcfe'
        };
        return {
            dark: { ...defaults },
            light: { ...defaults }
        };
    }

    getDefaultSyntaxFontStyles(): Record<string, Record<string, { bold?: boolean; italic?: boolean }>> {
        const empty: Record<string, { bold?: boolean; italic?: boolean }> = {};
        return {
            dark: { ...empty },
            light: { ...empty }
        };
    }

    renderKeybindings(container: HTMLElement) {
        container.innerHTML = '';
        for (const binding of this.keybindingSchema) {
            const row = document.createElement('div');
            row.className = 'keybinding-row';
            row.innerHTML = `
                <span class="keybinding-label">${this.escapeHtml(binding.label)}</span>
                <span class="keybinding-combo">${this.escapeHtml(binding.combo)}</span>
            `;
            container.appendChild(row);
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
        logInfo(`[编辑器设置][${type || 'info'}] ${message}`);
    }

    closeWindow() {
        window.close();
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new EditorSettings();
});
