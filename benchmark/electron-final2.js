const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const TMPDIR = '/tmp/oicpp_e2e_compare';
const LOG_DIR = path.join(__dirname, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = path.join(LOG_DIR, 'electron-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.jsonl');
let msgId = 1;
function logEvent(row) {
    fs.appendFileSync(LOG_FILE, JSON.stringify(row) + '\n');
}
function cdpEval(ws, expr, timeout) {
    return new Promise((resolve, reject) => {
        const id = msgId++;
        const timer = setTimeout(() => reject(new Error('CDP timeout')), timeout || 300000);
        const handler = (raw) => {
            const msg = JSON.parse(raw);
            if (msg.id === id) {
                clearTimeout(timer);
                ws.removeListener('message', handler);
                if (msg.result?.exceptionDetails) reject(new Error('JS: ' + (msg.result.exceptionDetails.exception?.description || msg.result.exceptionDetails.text)));
                else resolve(msg.result?.result?.value);
            }
        };
        ws.on('message', handler);
        ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true, timeout: timeout || 300000 } }));
    });
}

async function main() {
    console.log('='.repeat(72));
    console.log('  FINAL: Old vs V3 (fast-IO programs) — all via Electron IPC, 50 tests');
    console.log('='.repeat(72));
    const targets = await new Promise((res, rej) => http.get('http://127.0.0.1:9223/json', (r) => { let d=''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
    const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise(r => ws.on('open', r));
    await cdpEval(ws, '1+1');
    console.log('  Connected\n');

    const scenarios = [
        ['Sort',  'gen_sort', 'sort_std', 'sort_mergesort'],
        ['Graph', 'gen_graph', 'sp_dijkstra', 'sp_spfa'],
        ['Range', 'gen_range', 'range_bit', 'range_segtree'],
    ];

    console.log('[OLD] runProgram IPC (4 workers, 50 tests)');
    console.log('  Scenario    Time(ms)    TPS');
    for (const [label, g, a, b] of scenarios) {
        const r = await cdpEval(ws, `
            (async () => {
                let next = 0, ok = 0;
                const w = async () => {
                    while (true) {
                        const i = next++;
                        if (i >= 50) return;
                        const gen = await window.electronAPI.runProgram('${path.join(TMPDIR, g)}', '', 5000);
                        if (gen.exitCode !== 0) continue;
                        const input = (gen.stdout || '').trim();
                        const [std, test] = await Promise.all([
                            window.electronAPI.runProgram('${path.join(TMPDIR, a)}', input, 5000),
                            window.electronAPI.runProgram('${path.join(TMPDIR, b)}', input, 5000)
                        ]);
                        if (std.exitCode === 0 && test.exitCode === 0) ok++;
                    }
                };
                const t0 = Date.now();
                await Promise.all(Array.from({ length: 4 }, w));
                const ms = Date.now() - t0;
                return { ok, ms, tps: (ok / ms * 1000).toFixed(1) };
            })()
        `, 600000);
        const d = typeof r === 'string' ? JSON.parse(r) : r;
        console.log('  ' + label.padEnd(12) + String(d.ms).padStart(7) + 'ms   ' + d.tps);
    }

    console.log('\n[V3] CompareEngineV2 (4 threads, 50 tests)');
    console.log('  Scenario    Time(ms)    TPS     Errors');
    for (const [label, g, a, b] of scenarios) {
        const r = await cdpEval(ws, `
            (async () => {
                let completed = 0, errors = 0;
                const events = [];
                const cleanups = [];
                cleanups.push(window.electronAPI.onCompareProgress(d => { completed = d.current; events.push({ ts: Date.now(), scenario: '${label}', ok: true, kind: 'ok', testNumber: d.current, message: '' }); }));
                cleanups.push(window.electronAPI.onCompareError(e => { errors++; events.push({ ts: Date.now(), scenario: '${label}', ok: false, kind: e.type || 'err', testNumber: e.testNumber || 0, message: e.message || '', stdOutput: e.stdOutput || '', testOutput: e.testOutput || '' }); }));
                cleanups.push(window.electronAPI.onCompareComplete(d => { completed = d.completed || completed; }));
                const t0 = Date.now();
                await window.electronAPI.startCompare({
                    stdExe: { executablePath: '${path.join(TMPDIR, a)}' },
                    testExe: { executablePath: '${path.join(TMPDIR, b)}' },
                    generator: { executablePath: '${path.join(TMPDIR, g)}' },
                    totalTests: 50, timeLimit: 5000, threadCount: 8, useTestlib: false, freopen: null
                });
                for (let i = 0; i < 200; i++) { await new Promise(r => setTimeout(r, 500)); if (completed >= 50 || errors > 0) break; }
                cleanups.forEach(fn => { try { fn(); } catch(_) {} });
                return { ok: completed, events, ms: Date.now() - t0, tps: (completed / (Date.now() - t0) * 1000).toFixed(1), err: errors };
            })()
        `, 600000);
        const d = typeof r === 'string' ? JSON.parse(r) : r;
        for (const ev of d.events) logEvent(ev);
        logEvent({ type: 'summary', engine: 'electron-v6', scenario: label, threads: 8, total: 50, wallMs: d.ms, tps: +d.tps, ok: d.ok, failed: d.err });
        console.log('  ' + label.padEnd(12) + String(d.ms).padStart(7) + 'ms   ' + d.tps.padStart(6) + '     ' + d.err);
    }

    ws.close();
    console.log('\n  log written to: ' + LOG_FILE);
    console.log('\n' + '='.repeat(72));
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
