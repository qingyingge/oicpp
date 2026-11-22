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
        }
        interface IStandaloneCodeEditor {
            filePath?: string | null;
            fileName?: string;
            getFilePath?: () => string | null;
            highlightLine?: (line: number) => void;
            _markdownListenerAttached?: boolean;
            _markdownPreviewSyncAttached?: boolean;
        }
        interface IStandaloneDiffEditor {
            filePath?: string | null;
            fileName?: string;
            getModifiedEditor?: () => IStandaloneCodeEditor;
        }
    }
}
