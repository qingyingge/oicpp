// monaco-editor 模块增强：为 IStandaloneCodeEditor / ITextModel / languages 命名空间
// 添加运行时挂载属性，供渲染层 .ts 脚本使用。

declare module 'monaco-editor' {
    namespace editor {
        interface IStandaloneCodeEditor {
            __isDiffEditor?: boolean;
            __preprocessorColorListener?: unknown;
            __preprocessorLineDecorations?: string[];
            __diffMeta?: {
                originalPath?: string;
                modifiedPath?: string;
                label?: string;
            };
            __unifiedPreprocessorEnabled?: boolean;
            __unifiedPreprocessorColor?: string;
            onDidType?: (listener: (text: string) => void) => { dispose: () => void };
            getModifiedEditor?: () => IStandaloneCodeEditor;
        }
        interface ITextModel {
            __oicppLspCompletionFallbackUntil?: number;
        }
    }
    namespace languages {
        interface DocumentSymbol {
            name: string;
            detail: string;
            kind: number;
            tags: number[];
            range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
            selectionRange: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
            children?: DocumentSymbol[];
        }
        type SymbolKind = number;
    }
}
