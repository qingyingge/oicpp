import * as fs from 'fs';
import * as path from 'path';

interface LanguageMessages {
    [key: string]: unknown;
}

interface LanguageEntry {
    code: string;
    name: string;
    nameEn: string;
}

class LanguageManager {
    private _currentLang: string;
    private _messages: LanguageMessages;
    private _fallbackMessages: LanguageMessages;
    private _langDir: string;

    constructor() {
        this._currentLang = 'zh-cn';
        this._messages = {};
        this._fallbackMessages = {};
        this._langDir = __dirname;
        this._loadFallback();
    }

    private _loadFallback(): void {
        try {
            const fallbackPath = path.join(this._langDir, 'zh-cn.json');
            if (fs.existsSync(fallbackPath)) {
                this._fallbackMessages = JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
            }
        } catch (e) {
            console.error('[LanguageManager] Failed to load fallback language:', e);
        }
    }

    loadLanguage(lang: string): void {
        try {
            const langPath = path.join(this._langDir, `${lang}.json`);
            if (fs.existsSync(langPath)) {
                this._messages = JSON.parse(fs.readFileSync(langPath, 'utf8'));
                this._currentLang = lang;
            }
        } catch (e) {
            console.error(`[LanguageManager] Failed to load language ${lang}:`, e);
        }
    }

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
            return value.replace(/\{(\w+)\}/g, (_match, paramName: string) => {
                const paramValue = (params as Record<string, unknown>)[paramName];
                return paramValue !== undefined && paramValue !== null ? String(paramValue) : _match;
            });
        }

        return value;
    }

    private _getNested(obj: unknown, key: string): unknown {
        if (!obj || !key) {
            return undefined;
        }
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

    getCurrentLanguage(): string {
        return this._currentLang;
    }

    setLanguage(lang: string): void {
        this.loadLanguage(lang);
    }

    getAvailableLanguages(): LanguageEntry[] {
        return [
            { code: 'zh-cn', name: '中文（简体）', nameEn: 'Chinese (Simplified)' },
            { code: 'en', name: 'English', nameEn: 'English' }
        ];
    }
}

const instance = new LanguageManager();
instance.loadLanguage('zh-cn');

export const t = (key: string, params?: Record<string, unknown>): string => instance.t(key, params);
export const getCurrentLanguage = (): string => instance.getCurrentLanguage();
export const setLanguage = (lang: string): void => instance.setLanguage(lang);
export const getAvailableLanguages = (): LanguageEntry[] => instance.getAvailableLanguages();
export default instance;
