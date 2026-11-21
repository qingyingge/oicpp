"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAvailableLanguages = exports.setLanguage = exports.getCurrentLanguage = exports.t = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class LanguageManager {
    _currentLang;
    _messages;
    _fallbackMessages;
    _langDir;
    constructor() {
        this._currentLang = 'zh-cn';
        this._messages = {};
        this._fallbackMessages = {};
        this._langDir = __dirname;
        this._loadFallback();
    }
    _loadFallback() {
        try {
            const fallbackPath = path.join(this._langDir, 'zh-cn.json');
            if (fs.existsSync(fallbackPath)) {
                this._fallbackMessages = JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
            }
        }
        catch (e) {
            console.error('[LanguageManager] Failed to load fallback language:', e);
        }
    }
    loadLanguage(lang) {
        try {
            const langPath = path.join(this._langDir, `${lang}.json`);
            if (fs.existsSync(langPath)) {
                this._messages = JSON.parse(fs.readFileSync(langPath, 'utf8'));
                this._currentLang = lang;
            }
        }
        catch (e) {
            console.error(`[LanguageManager] Failed to load language ${lang}:`, e);
        }
    }
    t(key, params) {
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
            return value.replace(/\{(\w+)\}/g, (_match, paramName) => {
                const paramValue = params[paramName];
                return paramValue !== undefined && paramValue !== null ? String(paramValue) : _match;
            });
        }
        return value;
    }
    _getNested(obj, key) {
        if (!obj || !key) {
            return undefined;
        }
        const keys = key.split('.');
        let current = obj;
        for (const k of keys) {
            if (current === null || current === undefined || typeof current !== 'object') {
                return undefined;
            }
            current = current[k];
        }
        return current;
    }
    getCurrentLanguage() {
        return this._currentLang;
    }
    setLanguage(lang) {
        this.loadLanguage(lang);
    }
    getAvailableLanguages() {
        return [
            { code: 'zh-cn', name: '中文（简体）', nameEn: 'Chinese (Simplified)' },
            { code: 'en', name: 'English', nameEn: 'English' }
        ];
    }
}
const instance = new LanguageManager();
instance.loadLanguage('zh-cn');
const t = (key, params) => instance.t(key, params);
exports.t = t;
const getCurrentLanguage = () => instance.getCurrentLanguage();
exports.getCurrentLanguage = getCurrentLanguage;
const setLanguage = (lang) => instance.setLanguage(lang);
exports.setLanguage = setLanguage;
const getAvailableLanguages = () => instance.getAvailableLanguages();
exports.getAvailableLanguages = getAvailableLanguages;
exports.default = instance;
