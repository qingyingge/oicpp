// 全局声明：主进程/渲染层/preload 通过 contextBridge 或 AMD loader 注入的全局。
// 路线甲阶段只做「名称可解析」，签名先用 unknown[]，A3 负责把 electronAPI 细化。

declare function logInfo(...args: unknown[]): void;
declare function logWarn(...args: unknown[]): void;
declare function logError(...args: unknown[]): void;

declare function decodeBufferAuto(buffer: Buffer): string;
declare function updateProgress(channel: string, percent: number, msg?: string): void;

declare const APP_VERSION: string;

interface Window {
    oicppKeybindings?: unknown;
    i18next?: unknown;
    [key: string]: unknown;
}
