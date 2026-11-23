export {};

class DebugPanel {
    isActive = false;
    root: HTMLElement | null = null;
    bound = false;
    expandedVars = new Set<string>();
    loadingMore = new Set<string>();
    variableCache: { local: Record<string, unknown>; watches: Record<string, unknown>; global: Record<string, unknown> } = {
        local: {},
        watches: {},
        global: {}
    };
    pendingWatchRemovals = new Set<string>();

    constructor() {}

    activate() {
        this.isActive = true;
        if (!this.root) this._mount();
        if (!this.bound) this._bind();
    }

    deactivate() {
        this.isActive = false;
    }

    _mount() {
        const host = document.querySelector<HTMLElement>('#debug-panel .debug-content');
        if (!host) return;
        host.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.className = 'debug-mini-wrap';
        wrap.innerHTML = `
      <div class="debug-toolbar">
                <button id="dbg-start" class="icon-btn" data-i18n-title="debug.start" title="开始" aria-label="开始">
                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                        <path fill="currentColor" d="M5 3.5v9l7-4.5z"/>
                    </svg>
                </button>
                <button id="dbg-continue" class="icon-btn" data-i18n-title="debug.continue" title="继续(F6)" aria-label="继续">
                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                        <path fill="currentColor" d="M3 3h2v10H3V3zm4.5 0 6 5-6 5V3z"/>
                    </svg>
                </button>
                <button id="dbg-step-over" class="icon-btn" data-i18n-title="debug.stepOver" title="步过(F7)" aria-label="步过">
                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                        <path fill="currentColor" d="M2 3h1.4v10H2V3zm2.8 5 6.6-3.8v7.6L4.8 8z"/>
                    </svg>
                </button>
                <button id="dbg-step-into" class="icon-btn" data-i18n-title="debug.stepInto" title="步入(F8)" aria-label="步入">
                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                        <path fill="currentColor" d="M8 2v5H5l3 5 3-5H8V2zM3 13h10v1.5H3z"/>
                    </svg>
                </button>
                <button id="dbg-step-out" class="icon-btn" data-i18n-title="debug.stepOut" title="步出(Shift+F8)" aria-label="步出">
                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                        <path fill="currentColor" d="M8 14V9h3L8 4l-3 5h3v5zM3 2h10V3.5H3z"/>
                    </svg>
                </button>
                <button id="dbg-stop" class="icon-btn" data-i18n-title="debug.stop" title="停止" aria-label="停止">
                    <rect x="3" y="3" width="10" height="10" rx="1.2" fill="currentColor"/>
                </button>
        <div class="flex-spacer"></div>
      </div>
      <div class="debug-vars"></div>
    `;
        host.appendChild(wrap);
        this.root = wrap;
    }

    _bind() {
        this.bound = true;
        const startBtn = document.getElementById('dbg-start');
        if (startBtn) {
            startBtn.addEventListener('click', () => {
                if (window.electronAPI && window.electronAPI.send) {
                    window.electronAPI.send('debug-start');
                }
            });
        }
    }

    showVariables(variables: Record<string, unknown>) {
        this.variableCache.local = variables;
    }

    updateVariable(name: string, value: unknown) {
        this.variableCache.local[name] = value;
    }

    clearVariables() {
        this.variableCache = { local: {}, watches: {}, global: {} };
    }

    escapeHtml(text: string) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const debugPanel = new DebugPanel();
    (window as { debugPanel?: DebugPanel }).debugPanel = debugPanel;
});
