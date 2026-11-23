export {};

interface LspStartOptions {
    workspaceRoot?: string;
    workspaceName?: string;
    rootUri?: string;
    clangdArgs?: string[];
    fallbackFlags?: string[];
    compilerPath?: string;
}

interface LspStartResult {
    ok?: boolean;
    error?: string;
    alreadyRunning?: boolean;
    clangdPath?: string;
    fallbackFlags?: string[];
}

interface Diagnostic {
    uri?: string;
    diagnostics?: unknown[];
}

class LspClientBridge {
    private _ready = false;
    private _readyPromise: Promise<void> | null = null;
    private _serverCapabilities: Record<string, unknown> | null = null;
    private _semanticTokensLegend: Record<string, unknown> | null = null;
    private _readyListeners = new Set<(client: LspClientBridge) => void>();
    private _diagnosticListeners = new Set<(uri: string, diagnostics: unknown[]) => void>();
    private _notificationListeners = new Set<(payload: Record<string, unknown>) => void>();

    constructor() {
        this._ready = false;
        this._readyPromise = null;
        this._serverCapabilities = null;
        this._semanticTokensLegend = null;
        this._readyListeners = new Set();
        this._diagnosticListeners = new Set();
        this._notificationListeners = new Set();
        this._bindNotifications();
    }

    private _bindNotifications(): void {
        if (!window.electronAPI || typeof window.electronAPI.onLspNotification !== 'function') {
            return;
        }
        window.electronAPI.onLspNotification((payload: Record<string, unknown>) => {
            if (!payload || typeof payload.method !== 'string') {
                return;
            }
            if (payload.method === 'textDocument/publishDiagnostics') {
                const params = (payload.params as Record<string, unknown>) || {};
                const uri = String(params.uri || '');
                const diagnostics = Array.isArray(params.diagnostics) ? params.diagnostics : [];
                this._diagnosticListeners.forEach((listener) => {
                    try { listener(uri, diagnostics); } catch (_) {}
                });
            }
            this._notificationListeners.forEach((listener) => {
                try { listener(payload); } catch (_) {}
            });
        });
    }

    async start(options: LspStartOptions = {}): Promise<void> {
        if (this._readyPromise) {
            return this._readyPromise;
        }
        this._readyPromise = this._startInternal(options).catch((err: unknown) => {
            // 一次瞬态失败不能永久缓存 rejected Promise，否则 clangd 永远无法重试。
            this._readyPromise = null;
            throw err;
        });
        return this._readyPromise;
    }

    async restart(options: LspStartOptions = {}): Promise<void> {
        this._ready = false;
        this._readyPromise = null;
        this._readyPromise = this._restartInternal(options).catch((err: unknown) => {
            this._readyPromise = null;
            throw err;
        });
        return this._readyPromise;
    }

    private async _restartInternal(options: LspStartOptions = {}): Promise<void> {
        const api = window.electronAPI as {
            lspRestart?: (options: Record<string, unknown>) => Promise<Record<string, unknown>>;
            lspStop?: () => Promise<unknown>;
            lspStart?: (options: Record<string, unknown>) => Promise<Record<string, unknown>>;
        };
        if (!api) {
            throw new Error('LSP API unavailable');
        }

        if (typeof api.lspRestart === 'function') {
            const startResult = await api.lspRestart({
                workspaceRoot: options.workspaceRoot || '',
                clangdArgs: Array.isArray(options.clangdArgs) ? options.clangdArgs : [],
                fallbackFlags: Array.isArray(options.fallbackFlags) ? options.fallbackFlags : [],
                compilerPath: options.compilerPath || '',
                rootUri: options.rootUri || ''
            });

            if (!startResult || startResult.ok !== true) {
                const errMsg = startResult?.error || (window.i18n ? window.i18n.t('lsp.restartFailUnknown') : 'clangd 重启失败（未知原因）');
                logError('[LSP] clangd 重启失败:', errMsg);
                throw new Error('clangd restart failed: ' + errMsg);
            }

            if (startResult.alreadyRunning) {
                logInfo('[LSP] clangd 已在运行中，复用现有进程');
            } else {
                logInfo('[LSP] clangd 进程已启动:', String(startResult.clangdPath || ''));
            }

            await this._finishStartup(startResult as LspStartResult, options);
        }

        if (typeof api.lspStop === 'function') {
            await api.lspStop();
        }
        return await this._startInternal(options);
    }

    private async _startInternal(options: LspStartOptions = {}): Promise<void> {
        const api = window.electronAPI as {
            lspStart?: (options: Record<string, unknown>) => Promise<Record<string, unknown>>;
        };
        if (!api || typeof api.lspStart !== 'function') {
            logError('[LSP] LSP API 不可用，无法启动');
            throw new Error('LSP API unavailable');
        }

        const rootUri = options.rootUri || '';
        const workspaceFolders = rootUri
            ? [{ uri: rootUri, name: options.workspaceName || 'workspace' }]
            : [];

        logInfo('[LSP] 正在启动 clangd LSP 客户端...');
        logInfo('[LSP] 工作区根目录:', options.workspaceRoot || '(无)');
        logInfo('[LSP] rootUri:', rootUri || '(无)');
        if (Array.isArray(options.fallbackFlags) && options.fallbackFlags.length > 0) {
            logInfo('[LSP] 回退编译参数:', options.fallbackFlags.join(' '));
        }
        if (options.compilerPath) {
            logInfo('[LSP] 编译器路径:', options.compilerPath);
        }

        const startResult = await api.lspStart({
            workspaceRoot: options.workspaceRoot || '',
            clangdArgs: Array.isArray(options.clangdArgs) ? options.clangdArgs : [],
            fallbackFlags: Array.isArray(options.fallbackFlags) ? options.fallbackFlags : [],
            compilerPath: options.compilerPath || '',
            rootUri
        });

        // 检查 clangd 启动结果
        if (!startResult || startResult.ok !== true) {
            const errMsg = startResult?.error || (window.i18n ? window.i18n.t('lsp.startFailUnknown') : 'clangd 启动失败（未知原因）');
            logError('[LSP] clangd 启动失败:', errMsg);
            throw new Error('clangd start failed: ' + errMsg);
        }

        if (startResult.alreadyRunning) {
            logInfo('[LSP] clangd 已在运行中，复用现有进程');
        } else {
            logInfo('[LSP] clangd 进程已启动:', String(startResult.clangdPath || ''));
        }

        // 使用主进程返回的 fallbackFlags（已包含编译器 include 路径）
        const effectiveFallbackFlags = Array.isArray(startResult.fallbackFlags)
            ? startResult.fallbackFlags
            : (Array.isArray(options.fallbackFlags) ? options.fallbackFlags : []);

        await this._finishStartup(startResult as LspStartResult, options, api, effectiveFallbackFlags);
    }

    private async _finishStartup(startResult: LspStartResult, options: LspStartOptions = {}, api = window.electronAPI, effectiveFallbackFlags: string[] | null = null): Promise<Record<string, unknown>> {
        const lspApi = api as {
            lspRequest?: (method: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>;
            lspNotify?: (method: string, params: Record<string, unknown>) => Promise<unknown>;
        };
        const rootUri = options.rootUri || '';
        const workspaceFolders = rootUri
            ? [{ uri: rootUri, name: options.workspaceName || 'workspace' }]
            : [];

        const fallbackFlags = Array.isArray(effectiveFallbackFlags)
            ? effectiveFallbackFlags
            : (Array.isArray(startResult?.fallbackFlags)
                ? startResult.fallbackFlags
                : (Array.isArray(options.fallbackFlags) ? options.fallbackFlags : []));

        logInfo('[LSP] 发送 initialize 请求...');

        const initializeParams = {
            processId: null,
            rootUri: rootUri || null,
            workspaceFolders,
            capabilities: {
                textDocument: {
                    synchronization: {
                        didSave: true,
                        willSave: false,
                        willSaveWaitUntil: false
                    },
                    completion: {
                        completionItem: {
                            snippetSupport: true,
                            insertReplaceSupport: true,
                            resolveSupport: {
                                properties: ['detail', 'documentation', 'additionalTextEdits']
                            }
                        },
                        contextSupport: true,
                        dynamicRegistration: false
                    },
                    hover: {
                        contentFormat: ['markdown', 'plaintext']
                    },
                    signatureHelp: {
                        signatureInformation: {
                            documentationFormat: ['markdown', 'plaintext'],
                            parameterInformation: {
                                labelOffsetSupport: true
                            }
                        }
                    },
                    definition: {
                        linkSupport: true
                    },
                    documentSymbol: {
                        hierarchicalDocumentSymbolSupport: true,
                        symbolKind: {
                            valueSet: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26]
                        }
                    },
                    references: {},
                    semanticTokens: {
                        requests: { full: true },
                        tokenTypes: [],
                        tokenModifiers: [],
                        formats: ['relative']
                    }
                },
                workspace: {
                    workspaceFolders: true
                }
            },
            initializationOptions: {
                fallbackFlags
            }
        };

        const initResult = await lspApi.lspRequest('initialize', initializeParams);
        this._serverCapabilities = (initResult && (initResult as Record<string, unknown>).capabilities) ? (initResult as Record<string, unknown>).capabilities as Record<string, unknown> : null;
        const semTokensProvider = (this._serverCapabilities as Record<string, unknown>)?.semanticTokensProvider as Record<string, unknown> | undefined;
        this._semanticTokensLegend = semTokensProvider?.legend as Record<string, unknown> | null;

        const serverInfo = (initResult as Record<string, unknown>)?.serverInfo || {};
        logInfo('[LSP] 初始化完成, 服务器:', (serverInfo as Record<string, unknown>).name || 'clangd', '版本:', (serverInfo as Record<string, unknown>).version || '?');
        if (this._semanticTokensLegend) {
            logInfo('[LSP] 语义令牌支持: ' + (((this._semanticTokensLegend as Record<string, unknown>).tokenTypes as unknown[] | undefined)?.length || 0) + ' 种类型, ' + (((this._semanticTokensLegend as Record<string, unknown>).tokenModifiers as unknown[] | undefined)?.length || 0) + ' 种修饰符');
        }

        await lspApi.lspNotify('initialized', {});
        this._ready = true;
        logInfo('[LSP] clangd LSP 客户端就绪');

        this._readyListeners.forEach((listener) => {
            try { listener(this); } catch (_) {}
        });
        return initResult;
    }

    async request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
        const api = window.electronAPI as { lspRequest?: (method: string, params: Record<string, unknown>) => Promise<Record<string, unknown>> };
        if (!api || typeof api.lspRequest !== 'function') {
            throw new Error('LSP request API unavailable');
        }
        return await api.lspRequest(method, params);
    }

    async notify(method: string, params: Record<string, unknown>): Promise<unknown> {
        const api = window.electronAPI as { lspNotify?: (method: string, params: Record<string, unknown>) => Promise<unknown> };
        if (!api || typeof api.lspNotify !== 'function') {
            throw new Error('LSP notify API unavailable');
        }
        const result = await api.lspNotify(method, params);
        // 检查通知是否发送成功（进程可能已停止）
        if (result && (result as Record<string, unknown>).ok === false) {
            logWarn('[LSP] 通知发送失败 (' + method + '):', (result as Record<string, unknown>).error || '未知错误');
        }
        return result;
    }

    onReady(listener: (client: LspClientBridge) => void): () => void {
        if (typeof listener !== 'function') return () => {};
        this._readyListeners.add(listener);
        if (this._ready) {
            try { listener(this); } catch (_) {}
        }
        return () => this._readyListeners.delete(listener);
    }

    onDiagnostics(listener: (uri: string, diagnostics: unknown[]) => void): () => void {
        if (typeof listener !== 'function') return () => {};
        this._diagnosticListeners.add(listener);
        return () => this._diagnosticListeners.delete(listener);
    }

    onNotification(listener: (payload: Record<string, unknown>) => void): () => void {
        if (typeof listener !== 'function') return () => {};
        this._notificationListeners.add(listener);
        return () => this._notificationListeners.delete(listener);
    }

    getSemanticTokensLegend(): Record<string, unknown> | null {
        return this._semanticTokensLegend;
    }

    getServerCapabilities(): Record<string, unknown> | null {
        return this._serverCapabilities;
    }
}

window.LspClientBridge = LspClientBridge;
window.lspClient = window.lspClient || new LspClientBridge();
