export {};

/**
 * Renderer-side i18n module.
 *
 * Provides translation capabilities to the renderer process.
 * Language files are loaded from the main process via IPC.
 *
 * Usage:
 *   const __ = i18n.t;  // or use i18n.t directly
 *   __('menu.file');     // => "文件" or "File"
 *   __('message.updateDownloading', { version: ' v2.0', progress: 50 });
 */
class I18nManager {
    private _messages: Record<string, unknown> = {};
    private _fallbackMessages: Record<string, unknown> = {};
    private _currentLang = 'zh-cn';
    private _loaded = false;
    private _readyPromise: Promise<void> | null = null;
    private _listeners: Array<(lang: string) => void> = [];

    /**
     * Initialize: load from main process settings.
     * Call this early in app initialization.
     */
    async init(): Promise<void> {
        if (this._readyPromise) return this._readyPromise;

        this._readyPromise = this._doInit();
        return this._readyPromise;
    }

    private async _doInit(): Promise<void> {
        try {
            // Load current language from settings
            if (window.electronAPI && typeof window.electronAPI.getLanguage === 'function') {
                this._currentLang = await window.electronAPI.getLanguage();
            }

            // Load current language file
            await this._loadCurrentLanguage();

            // Listen for language changes
            if (window.electronAPI && typeof window.electronAPI.onLanguageChanged === 'function') {
                window.electronAPI.onLanguageChanged(async (langCode: string) => {
                    this._currentLang = langCode || 'zh-cn';
                    await this._loadCurrentLanguage();
                    this._notifyListeners();
                    this._applyToDOM();
                });
            }

            // Also listen for settings-changed (which includes language)
            if (window.electronIPC && window.electronIPC.on) {
                const originalOn = window.electronIPC.on.bind(window.electronIPC);
                window.electronIPC.on('settings-changed', async (_event: unknown, _settingsType: unknown, newSettings: unknown) => {
                    const ns = newSettings as Record<string, unknown> | undefined;
                    if (ns && ns.language && ns.language !== this._currentLang) {
                        this._currentLang = String(ns.language);
                        await this._loadCurrentLanguage();
                        this._notifyListeners();
                        this._applyToDOM();
                    }
                });
            }

            // Apply to DOM after loading
            this._applyToDOM();

            logInfo('[i18n] 语言初始化完成:', this._currentLang);
        } catch (error) {
            logError('[i18n] 初始化失败:', error);
        }
    }

    private async _loadCurrentLanguage(): Promise<void> {
        try {
            if (window.electronAPI && typeof window.electronAPI.getLanguageFile === 'function') {
                const messages = await window.electronAPI.getLanguageFile(this._currentLang);
                if (messages) {
                    this._messages = messages as Record<string, unknown>;
                    this._loaded = true;

                    // Also try to load fallback (Chinese)
                    if (this._currentLang !== 'zh-cn') {
                        const fallback = await window.electronAPI.getLanguageFile('zh-cn');
                        if (fallback) {
                            this._fallbackMessages = fallback as Record<string, unknown>;
                        }
                    }
                }
            }
        } catch (error) {
            logError('[i18n] 加载语言文件失败:', error);
        }
    }

    /**
     * Translate a key.
     * @param {string} key - Dot-notation key, e.g. 'menu.file'
     * @param {object} [params] - Template parameters for substitution
     * @returns {string}
     */
    t(key: string, params?: Record<string, unknown>): string {
        if (!key || typeof key !== 'string') {
            return key || '';
        }

        let value = this._getNested(this._messages, key);
        if (value === undefined || value === null) {
            value = this._getNested(this._fallbackMessages, key);
        }

        if (value === undefined || value === null) {
            return key;
        }

        if (typeof value !== 'string') {
            return String(value);
        }

        if (params && typeof params === 'object') {
            return value.replace(/\{(\w+)\}/g, (match: string, paramName: string) => {
                const paramValue = params[paramName];
                return paramValue !== undefined && paramValue !== null ? String(paramValue) : match;
            });
        }

        return value;
    }

    /**
     * Short alias for t()
     */
    translate(key: string, params?: Record<string, unknown>): string {
        return this.t(key, params);
    }

    /**
     * Get the current language code.
     */
    getCurrentLanguage(): string {
        return this._currentLang;
    }

    /**
     * Get available languages from main process.
     */
    async getAvailableLanguages(): Promise<string[]> {
        try {
            if (window.electronAPI && typeof window.electronAPI.getAvailableLanguages === 'function') {
                return await window.electronAPI.getAvailableLanguages();
            }
        } catch (e) {
            logError('[i18n] 获取可用语言列表失败:', e);
        }
        return [];
    }

    /**
     * Set language and save to settings.
     */
    async setLanguage(langCode: string): Promise<void> {
        if (!langCode || langCode === this._currentLang) return;
        try {
            if (window.electronAPI && typeof window.electronAPI.updateSettings === 'function') {
                await window.electronAPI.updateSettings({ language: langCode });
            }
        } catch (error) {
            logError('[i18n] 设置语言失败:', error);
        }
    }

    /**
     * Register a listener for language changes.
     * @param {Function} callback
     * @returns {Function} Unsubscribe function
     */
    onChange(callback: (lang: string) => void): () => void {
        if (typeof callback !== 'function') return () => {};
        this._listeners.push(callback);
        return () => {
            const idx = this._listeners.indexOf(callback);
            if (idx >= 0) this._listeners.splice(idx, 1);
        };
    }

    private _notifyListeners(): void {
        for (const listener of this._listeners) {
            try {
                listener(this._currentLang);
            } catch (_) {}
        }
    }

    /**
     * Apply translation to DOM elements with data-i18n attributes.
     * Elements with data-i18n="key" will have their textContent replaced.
     * Elements with data-i18n-placeholder="key" will have their placeholder replaced.
     * Elements with data-i18n-title="key" will have their title replaced.
     *
     * This is the public method - panels can call it after dynamic rendering.
     */
    applyTranslation(): void {
        this._applyToDOM();
    }

    /**
     * Internal: apply translation to DOM elements with data-i18n attributes.
     */
    public _applyToDOM(): void {
        try {
            // Translate text content
            document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => {
                const key = el.getAttribute('data-i18n');
                if (!key) return;
                const text = this.t(key);
                // 元素内部如果有子元素（复选框、图标等），不能直接覆盖 textContent，
                // 否则会把 checkbox / svg 一起删掉。只替换文字节点。
                if (el.children.length === 0) {
                    el.textContent = text;
                    return;
                }
                const textNodes = Array.from(el.childNodes).filter(node => node.nodeType === 3) as Text[];
                const target = textNodes.find(node => node.nodeValue?.trim()) || textNodes[textNodes.length - 1];
                if (target) {
                    target.nodeValue = text;
                } else {
                    el.appendChild(document.createTextNode(text));
                }
            });

            // Translate placeholders
            document.querySelectorAll<HTMLElement>('[data-i18n-placeholder]').forEach(el => {
                const key = el.getAttribute('data-i18n-placeholder');
                if (key) {
                    (el as HTMLInputElement).placeholder = this.t(key);
                }
            });

            // Translate titles
            document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach(el => {
                const key = el.getAttribute('data-i18n-title');
                if (key) {
                    el.title = this.t(key);
                }
            });

            // Update html lang attribute
            document.documentElement.lang = this._currentLang;
        } catch (_) {}
    }

    /**
     * Set up a MutationObserver to automatically translate
     * newly added elements with data-i18n attributes.
     * Call this after the app is ready.
     */
    enableAutoTranslate(): void {
        if (this._observer) return;
        try {
            this._observer = new MutationObserver((mutations: MutationRecord[]) => {
                let needsTranslate = false;
                for (const mutation of mutations) {
                    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                        for (const node of mutation.addedNodes) {
                            if (node.nodeType === 1) { // Element
                                const el = node as Element;
                                if (el.hasAttribute && (
                                    el.hasAttribute('data-i18n') ||
                                    el.hasAttribute('data-i18n-placeholder') ||
                                    el.hasAttribute('data-i18n-title') ||
                                    el.querySelector('[data-i18n],[data-i18n-placeholder],[data-i18n-title]')
                                )) {
                                    needsTranslate = true;
                                    break;
                                }
                            }
                        }
                    }
                    if (needsTranslate) break;
                }
                if (needsTranslate) {
                    this._applyToDOM();
                }
            });
            this._observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        } catch (_) {}
    }

    private _getNested(obj: Record<string, unknown> | null | undefined, key: string | null | undefined): unknown {
        if (!obj || !key) return undefined;
        const keys = key.split('.');
        let current: unknown = obj;
        for (const k of keys) {
            if (current === null || current === undefined || typeof current !== 'object') {
                return undefined;
            }
            current = (current as Record<string, unknown>)[k];
        }
        return current;
    }

    private _observer: MutationObserver | null = null;
}

// Create global singleton
const i18n = new I18nManager();

// Expose globally
window.i18n = i18n;
window.__ = i18n.t.bind(i18n);
