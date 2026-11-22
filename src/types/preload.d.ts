// Preload 脚本暴露给渲染层的 electronAPI 类型声明。
// 渲染层通过 window.electronAPI 访问，主进程通过 contextBridge 注入。

declare const electronAPI: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    send(channel: string, ...args: unknown[]): void;
    on(channel: string, listener: (...args: unknown[]) => void): void;
    [key: string]: unknown;
};

interface Window {
    electronAPI?: typeof electronAPI;
}
