// monaco-editor 的 ESM 类型入口（esm/vs/index.d.ts）只出模块导出，不带全局别名；
// 而渲染层是 <script> 形态、不能 import，运行时用的是 AMD loader 注入的全局 monaco。
// 这里把整个模块挂成 UMD 全局命名空间，脚本文件才能同时取到 monaco 的值和它的类型。
export * from 'monaco-editor';
export as namespace monaco;

// 运行时挂载在编辑器实例上的自定义属性（monaco 公共 API 之外），供 tabs.ts / main.ts /
// compile-manager.ts / codeComparer.ts / sampleTester.ts 等使用。
declare module 'monaco-editor' {
    namespace editor {
        interface ITextModel {
            __oicppFilePath?: string | null;
            __oicppLspUri?: string;
            __oicppLspCompletionFallbackUntil?: number;
        }
        interface IStandaloneCodeEditor {
            filePath?: string | null;
            fileName?: string;
            getFilePath?: () => string | null;
            highlightLine?: (line: number) => void;
            _markdownListenerAttached?: boolean;
            _markdownPreviewSyncAttached?: boolean;
            onDidType?: (listener: (text: string) => void) => IDisposable;
            getModifiedEditor?: () => IStandaloneCodeEditor;
            __isDiffEditor?: boolean;
            __preprocessorColorListener?: IDisposable;
            __preprocessorLineDecorations?: string[];
            __diffMeta?: { originalPath?: string; modifiedPath?: string; label?: string };
            __unifiedPreprocessorEnabled?: boolean;
            __unifiedPreprocessorColor?: string;
        }
        interface IStandaloneDiffEditor {
            filePath?: string | null;
            fileName?: string;
            getModifiedEditor?: () => IStandaloneCodeEditor;
            __isDiffEditor?: boolean;
            __diffMeta?: DiffEditorMeta;
            getValue?: () => string;
            setValue?: (val: string) => void;
        }
        interface DiffEditorMeta {
            originalPath?: string;
            modifiedPath?: string;
            label?: string;
            originalFileName?: string;
            modifiedFileName?: string;
            originalContent?: string;
            modifiedContent?: string;
            groupId?: string;
            targetGroupId?: string;
        }
        type CreateDiffEditorOptions = IDiffEditorOptions & {
            groupId?: string | null;
            targetGroupId?: string;
            originalPath?: string;
            modifiedPath?: string;
            label?: string | null;
            originalContent?: string;
            modifiedContent?: string;
            originalFileName?: string;
            modifiedFileName?: string;
            fontSize?: number;
            lineHeight?: number;
            fontFamily?: string;
            tabSize?: number;
            wordWrap?: 'off' | 'on' | 'wordWrapColumn' | 'bounded';
            folding?: boolean;
            stickyScroll?: boolean;
            fontLigatures?: boolean;
            quickSuggestions?: boolean | IQuickSuggestionsOptions;
            suggestOnTriggerCharacters?: boolean;
            wordBasedSuggestions?: 'off' | 'matchingDocuments' | 'matchingDocumentsAndGlobal';
            tabCompletion?: 'on' | 'off' | 'onlySnippets';
            acceptSuggestionOnEnter?: 'on' | 'smart' | 'off';
            parameterHints?: { enabled: boolean; cycle: boolean };
            formatterIndentStyle?: string;
            clangFormatRaw?: string;
            clangFormatStyle?: string;
            clangFormat?: string;
            clangFormatSettings?: Record<string, unknown>;
            skipLine?: boolean;
            skipTypedef?: boolean;
            baseDir?: string;
            filePath?: string;
            cacheKey?: string;
            useCache?: boolean;
            allowWorkspaceScan?: boolean;
            viewType?: string;
            isTempFile?: boolean;
            isPreviewTab?: boolean;
            sourceTabKey?: string;
            pdfBase64?: string;
            browserUrl?: string;
            diffMeta?: DiffEditorMeta;
            externalModified?: boolean;
            externalPromptInProgress?: boolean;
            externalPromptDismissed?: boolean;
            pendingExternalPrompt?: boolean;
            externalChangeType?: string;
            modified?: boolean;
            uniqueKey?: string;
            uniqueKeyOverride?: string;
            force?: boolean;
            skipCloseConfirm?: boolean;
            skipAutoSave?: boolean;
            previewContainer?: HTMLElement;
            viewerContainer?: HTMLElement;
            viewerFrame?: HTMLIFrameElement;
            tabId?: string;
            tabKey?: string;
            sourceGroupId?: string;
            tabElement?: HTMLElement;
            startX?: number;
            startY?: number;
            isDirty?: boolean;
            element?: HTMLElement;
            content?: string;
            active?: boolean;
            externalChangeTimestamp?: number;
        };
    }
    namespace languages {
        const registerWorkspaceSymbolProvider: ((provider: unknown) => IDisposable) | undefined;
        interface CompletionItem {
            __oicppLspItem?: unknown;
        }
        interface InlayHint {
            __oicppLspInlayHint?: unknown;
        }
        interface ILink {
            __oicppLspDocumentLink?: unknown;
        }
        interface CodeLens {
            __oicppLspCodeLens?: unknown;
        }
    }
}
