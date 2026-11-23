// 全局声明：主进程/渲染层/preload 通过 contextBridge 或 AMD loader 注入的全局。
// 路线甲阶段只做「名称可解析」，签名先用 unknown[]，A3 负责把 electronAPI 细化。

declare function logInfo(...args: unknown[]): void;
declare function logWarn(...args: unknown[]): void;
declare function logError(...args: unknown[]): void;

declare function decodeBufferAuto(buffer: Buffer): string;
declare function updateProgress(message: string, percent?: number | null, speed?: string | null): void;

declare const APP_VERSION: string;

declare const oicppKeybindings: unknown;
declare const i18next: unknown;

interface Window {
    oicppKeybindings?: unknown;
    i18next?: unknown;

    // electronAPI (contextBridge)
    electronAPI?: {
        getIdeLoginStatus?: () => Promise<{ loggedIn?: boolean; user?: { username?: string } }>;
        clipboardWriteText?: (text: string) => void;
        browserResolveUrl?: (url: string) => string;
        readFileContent?: (filePath: string) => Promise<string>;
        onRequestSaveAll?: (cb: () => Promise<unknown>) => void;
        notifySaveAllFailed?: (d: unknown) => void;
        notifySaveAllComplete?: () => void;
        getUserIconPath?: () => Promise<string>;
        send?: (channel: string, ...args: unknown[]) => void;
        saveAsFile?: (content: string, filePath?: string) => Promise<unknown>;
        on?: (channel: string, listener: (...args: unknown[]) => void) => void;
    };

    // electronIPC
    electronIPC?: {
        send?: (channel: string, ...args: unknown[]) => void;
        on?: (channel: string, listener: (...args: unknown[]) => void) => void;
    };

    // i18n
    i18n?: {
        init?: () => Promise<void>;
        enableAutoTranslate?: () => void;
        t?: (key: string, params?: Record<string, unknown>) => string;
    };

    // Sidebar
    sidebarManager?: {
        getPanelManager?: (name: string) => unknown;
        updateFileExplorerButtons?: () => void;
        checkResizeStatus?: () => void;
    };

    // TabManager
    tabManager?: {
        saveAllFiles?: () => Promise<{ success: boolean; failures: any[] }>;
        saveCurrentFile?: () => Promise<unknown>;
        getTabCount?: () => number;
        showWelcomePage?: () => void;
        getUnsavedFiles?: () => unknown;
        tabs?: Map<string, unknown>;
        getTabContentForSave?: (tab: unknown) => unknown;
        saveAsFile?: (content: string, filePath?: string) => Promise<unknown>;
    };

    // OICPPApp
    oicppApp?: {
        init?: () => Promise<void>;
        saveCurrentFile?: () => Promise<unknown>;
        saveCurrentOpenTabs?: (tabs?: unknown) => void;
        createNewCppFile?: () => void;
        openDroppedFile?: (filePath: string) => void;
        showMessage?: (message: string, type?: string) => void;
        getActiveFilePath?: () => string | null;
        isCloudFilePath?: (path: string) => boolean;
    };

    // dialogManager
    dialogManager?: {
        showNewYearGreeting?: (d: Date) => void;
        showSpringFestivalGreeting?: (d: Date) => void;
        showConfirmDialog?: (title: string, msg: string) => Promise<void>;
        showActionDialog?: (title: string, msg: string, buttons: Array<{ id: string; label: string; className?: string }>) => Promise<unknown>;
        showError?: (title: string, msg: string) => void;
    };

    // Titlebar
    titlebarManager?: unknown;

    // uiIcons
    uiIcons?: {
        hydrate?: (container: HTMLElement) => void;
        svg?: unknown;
    };

    [key: string]: unknown;
}
