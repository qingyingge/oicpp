export {};

interface QuickOpenFile {
    name: string;
    path: string;
}

let allFiles: QuickOpenFile[] = [];
let indexedRoot = '';
let indexDirty = true;
const overlay = document.getElementById('quick-open-overlay') as HTMLElement | null;
const input = document.getElementById('quick-open-input') as HTMLElement | null;
const results = document.getElementById('quick-open-results') as HTMLElement | null;
const titleTrigger = document.getElementById('titlebar-quickopen') as HTMLElement | null;
let activeIndex = -1;

(function init(): void {
    if (!overlay || !input || !results) return;

function fuzzyScore(query: string, fullPath: string): number {
    if (!query) return 0;
    const q = query.toLowerCase();
    const p = fullPath.toLowerCase();
    const lastSlash = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
    const base = p.slice(lastSlash + 1);
    if (base === q) return 10_000;
    if (p === q) return 9_000;
    if (base.endsWith(q)) return 8_000 - base.length; // 越短越靠前
    if (base.startsWith(q)) return 7_000 - base.length;
    if (base.includes(q)) return 6_000 - base.indexOf(q);
    let qi = 0, score = 0;
    for (let i = 0; i < p.length && qi < q.length; i++) {
        if (p[i] === q[qi]) { score += 2; qi++; }
        else if (q.includes(p[i])) { score += 1; }
    }
    if (qi === q.length) score += 5;
    return score;
}

function render(list: QuickOpenFile[]): void {
    results.innerHTML = '';
    if (list.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'quick-open-empty';
        empty.textContent = window.i18n ? window.i18n.t('panel.noMatch') : '未找到匹配项';
        results.appendChild(empty);
        return;
    }
    list.forEach((item, idx) => {
        const row = document.createElement('div');
        row.className = 'quick-open-item';
        if (idx === activeIndex) row.classList.add('active');
        const name = document.createElement('div');
        name.className = 'name';
        name.textContent = item.name;
        const sub = document.createElement('div');
        sub.className = 'sub';
        sub.textContent = item.path;
        row.appendChild(name);
        row.appendChild(sub);
        row.addEventListener('click', () => openFile(item));
        results.appendChild(row);
    });
}

let lastList: QuickOpenFile[] = [];
function markIndexDirty(): void {
    indexDirty = true;
}

function search(query: string): void {
    if (!query) {
        lastList = allFiles.slice(0, 100);
        activeIndex = lastList.length ? 0 : -1;
        render(lastList);
        return;
    }
    const ranked = allFiles.map(f => ({ ...f, __s: fuzzyScore(query, f.path) } as QuickOpenFile & { __s: number }))
        .filter((x: QuickOpenFile & { __s: number }) => x.__s > 0)
        .sort((a: QuickOpenFile & { __s: number }, b: QuickOpenFile & { __s: number }) => b.__s - a.__s || a.path.length - b.path.length);
    // 渲染与键盘导航必须使用同一份截断后的列表，否则会越界或打开不可见项。
    lastList = ranked.slice(0, 200);
    activeIndex = lastList.length ? 0 : -1;
    render(lastList);
}

async function ensureIndex(): Promise<boolean> {
    const fileExplorer = window.sidebarManager?.panels?.files;
    const root = fileExplorer?.currentPath || fileExplorer?.workspacePath || '';
    if (!root) return false;
    if (!indexDirty && indexedRoot === root && allFiles.length > 0) return true;
    indexedRoot = root;
    try {
        const res = await window.electronAPI.walkDirectory(root, { excludeGlobs: ['node_modules', '.git', '.oicpp', '.vscode'] });
        if (res && res.success) {
            allFiles = res.files || [];
            indexDirty = false;
            return true;
        }
    } catch (e) {
        (logWarn || console.warn)('walkDirectory 失败:', e);
    }
    return false;
}

function open(): void {
    overlay.classList.add('open');
    (input as HTMLInputElement).value = '';
    input.focus();
    lastList = allFiles.slice(0, 100);
    activeIndex = lastList.length ? 0 : -1;
    render(lastList);
}

function close(): void {
    overlay.classList.remove('open');
}

async function openFile(item: QuickOpenFile): Promise<void> {
    try {
        const isPdf = item?.name?.toLowerCase?.().endsWith('.pdf');
        if (isPdf) {
            const tm = window.tabManager as { openFile?: (name: string, content: string, readonly: boolean, options?: { filePath?: string; viewType?: string }) => void } | undefined;
            if (tm?.openFile) {
                await tm.openFile(item.name, '', false, { filePath: item.path, viewType: 'pdf' });
            } else {
                (logWarn || console.warn)('tabManager 不可用，无法打开PDF:', item?.path);
            }
            close();
            return;
        }
        const content = await window.electronAPI.readFileContent(item.path);
        const fileName = item.name;
        const tm2 = window.tabManager as { openFile?: (name: string, content: string, readonly: boolean, options?: { filePath?: string }) => void } | undefined;
        if (tm2?.openFile) {
            tm2.openFile(fileName, content, false, { filePath: item.path });
        } else {
            const em = window.editorManager as { openFile?: (filePath: string, content: string) => void } | undefined;
            if (em?.openFile) {
                em.openFile(item.path, content);
            }
        }
        close();
    } catch (e) {
        (logError || console.error)('打开文件失败:', e);
    }
}
input.addEventListener('input', () => search((input as HTMLInputElement).value.trim()));
input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Enter') {
        const list = lastList;
        if (list.length > 0) {
            const idx = activeIndex >= 0 && activeIndex < list.length ? activeIndex : 0;
            openFile(list[idx]);
        }
    }
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        const list = lastList;
        if (list.length) {
            activeIndex = Math.min((activeIndex < 0 ? -1 : activeIndex) + 1, list.length - 1);
            render(list);
            ensureActiveVisible();
        }
    }
    if (e.key === 'ArrowUp') {
        e.preventDefault();
        const list = lastList;
        if (list.length) {
            activeIndex = Math.max((activeIndex < 0 ? 0 : activeIndex) - 1, 0);
            render(list);
            ensureActiveVisible();
        }
    }
});

function ensureActiveVisible(): void {
    const items = results.querySelectorAll('.quick-open-item');
    if (!items || !items.length || activeIndex < 0) return;
    const el = items[activeIndex] as HTMLElement;
    if (!el) return;
    const rTop = results.scrollTop;
    const rBottom = rTop + results.clientHeight;
    const eTop = el.offsetTop;
    const eBottom = eTop + el.offsetHeight;
    if (eTop < rTop) results.scrollTop = eTop;
    else if (eBottom > rBottom) results.scrollTop = eBottom - results.clientHeight;
}

document.addEventListener('keydown', async (e: KeyboardEvent) => {
    const isInEditor = (e.target as Element)?.closest?.('.monaco-editor');
    if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        const ok = await ensureIndex();
        if (ok) open();
    }
});

overlay.addEventListener('click', (e: MouseEvent) => { if (e.target === overlay) close(); });

window.quickOpen = { open, close, ensureIndex };

if (window.electronIPC?.on) {
    window.electronIPC.on('file-renamed', (_event, _oldPath, _newPath, error) => {
        if (!error) markIndexDirty();
    });
    window.electronIPC.on('file-created', (_event, _filePath, error) => {
        if (!error) markIndexDirty();
    });
    window.electronIPC.on('folder-created', (_event, _folderPath, error) => {
        if (!error) markIndexDirty();
    });
    window.electronIPC.on('file-deleted', (_event, _filePath, error) => {
        if (!error) markIndexDirty();
    });
    window.electronIPC.on('file-pasted', (_event, _sourcePath, _targetPath, _operation, error) => {
        if (!error) markIndexDirty();
    });
}

document.addEventListener('workspace-opened', () => {
    markIndexDirty();
});

if (titleTrigger) {
    titleTrigger.addEventListener('click', async (e: MouseEvent) => {
        e.preventDefault();
        const ok = await ensureIndex();
        if (ok) open();
    });
}
})();
