const http = require('http');
const WebSocket = require('ws');
http.get('http://127.0.0.1:9222/json', (res) => { let d=''; res.on('data', c => d += c); res.on('end', () => {
    const page = JSON.parse(d).find(t => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.on('open', () => {
        const expr = `(async () => {
            let completed = 0, errors = [];
            const c1 = window.electronAPI.onCompareProgress(d => { completed = d.current; });
            const c2 = window.electronAPI.onCompareError(e => { errors.push(e.message); });
            const t0 = Date.now();
            await window.electronAPI.startCompare({
                stdExe: { executablePath: '/tmp/oicpp/compare-benchmark/progs/sort_std' },
                testExe: { executablePath: '/tmp/oicpp/compare-benchmark/progs/sort_mergesort' },
                generator: { executablePath: '/tmp/oicpp/compare-benchmark/progs/gen_sort' },
                totalTests: 5, timeLimit: 10000, threadCount: 8, useTestlib: false, freopen: null
            });
            for (let i = 0; i < 30; i++) { await new Promise(r => setTimeout(r, 500)); if (completed >= 5 || errors.length) break; }
            c1(); c2();
            return { ok: completed === 5, completed, errors, ms: Date.now() - t0 };
        })()`;
        ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
    });
    ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.id===1) { console.log('E2E:', JSON.stringify(m.result?.result?.value)); process.exit(0); } });
    setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 25000);
}); });
