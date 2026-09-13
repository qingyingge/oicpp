const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const PROGS = path.join(__dirname, '..', 'compare-benchmark', 'progs');
const TMPDIR = '/tmp/oicpp_e2e_compare';
fs.mkdirSync(TMPDIR, { recursive: true });

let msgId = 1;
function cdpEval(ws, expr, timeout) {
    return new Promise((resolve, reject) => {
        const id = msgId++;
        const timer = setTimeout(() => reject(new Error('CDP timeout')), timeout || 180000);
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
        ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true, timeout: timeout || 180000 } }));
    });
}

async function main() {
    const os = require('os');
    console.log('='.repeat(70));
    console.log('  FINAL: Old vs V2 vs V3 (all through Electron IPC)');
    console.log('  CPU: ' + (os.cpus()[0]?.model || '?') + ' x' + os.cpus().length);
    console.log('='.repeat(70));

    console.log('\n[1] Compiling...');
    const names = ['gen_sort','sort_std','sort_mergesort','gen_graph','sp_dijkstra','sp_spfa','gen_range','range_bit','range_segtree'];
    for (const n of names) {
        await new Promise((resolve, reject) => {
            spawn('g++', ['-O2', '-std=c++14', '-o', path.join(TMPDIR, n), path.join(PROGS, n + '.cpp')], { stdio: 'pipe' })
                .on('close', c => c === 0 ? resolve() : reject(new Error('compile ' + n)));
        });
    }
    console.log('  OK');

    console.log('\n[2] Connecting...');
    const targets = await new Promise((resolve, reject) => {
        http.get('http://127.0.0.1:9222/json', (res) => {
            let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)));
        }).on('error', reject);
    });
    const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise(r => ws.on('open', r));
    await cdpEval(ws, '1+1');
    console.log('  Connected\n');

    const TOTAL = 50;
    const scenarios = [
        ['Sort',  'gen_sort', 'sort_std', 'sort_mergesort'],
        ['Graph', 'gen_graph', 'sp_dijkstra', 'sp_spfa'],
        ['Range', 'gen_range', 'range_bit', 'range_segtree'],
    ];

    // ─── OLD: runProgram IPC ───
    console.log('[OLD] runProgram IPC — ' + TOTAL + ' tests, 4 workers');
    console.log('  Scenario    Time(ms)    TPS');
    console.log('  ' + '-'.repeat(35));
    for (const [label, g, a, b] of scenarios) {
        const r = await cdpEval(ws, `
            (async () => {
                const genExe = '${path.join(TMPDIR, g)}';
                const stdExe = '${path.join(TMPDIR, a)}';
                const testExe = '${path.join(TMPDIR, b)}';
                let next = 0, ok = 0;
                const w = async () => {
                    while (true) {
                        const i = next++;
                        if (i >= ${TOTAL}) return;
                        const gen = await window.electronAPI.runProgram(genExe, '', 5000);
                        if (gen.exitCode !== 0) continue;
                        const std = await window.electronAPI.runProgram(stdExe, (gen.stdout||'').trim(), 5000);
                        const test = await window.electronAPI.runProgram(testExe, (gen.stdout||'').trim(), 5000);
                        if (std.exitCode === 0 && test.exitCode === 0) ok++;
                    }
                };
                const t0 = Date.now();
                await Promise.all(Array.from({ length: 4 }, w));
                return { ok, ms: Date.now() - t0, tps: (ok / (Date.now() - t0) * 1000).toFixed(1) };
            })()
        `, 600000);
        const d = typeof r === 'string' ? JSON.parse(r) : r;
        console.log('  ' + label.padEnd(12) + String(d.ms).padStart(7) + 'ms   ' + d.tps);
    }

    // ─── V3: startCompare (Worker Threads + pre-spawn) ───
    console.log('\n[V3] startCompare (Worker Threads + pre-spawn) — ' + TOTAL + ' tests, 4 threads');
    console.log('  Scenario    Time(ms)    TPS     Errors');
    console.log('  ' + '-'.repeat(45));
    for (const [label, g, a, b] of scenarios) {
        const r = await cdpEval(ws, `
            (async () => {
                let completed = 0, errors = 0;
                const cleanups = [];
                cleanups.push(window.electronAPI.onCompareProgress(d => { completed = d.current; }));
                cleanups.push(window.electronAPI.onCompareError(() => { errors++; }));
                cleanups.push(window.electronAPI.onCompareComplete(d => { completed = d.completed || completed; }));
                const t0 = Date.now();
                await window.electronAPI.startCompare({
                    stdExe: { executablePath: '${path.join(TMPDIR, a)}' },
                    testExe: { executablePath: '${path.join(TMPDIR, b)}' },
                    generator: { executablePath: '${path.join(TMPDIR, g)}' },
                    totalTests: ${TOTAL}, timeLimit: 5000, threadCount: 4, useTestlib: false, freopen: null
                });
                for (let i = 0; i < 180; i++) { await new Promise(r => setTimeout(r, 500)); if (completed >= ${TOTAL} || errors > 0) break; }
                cleanups.forEach(fn => { try { fn(); } catch(_) {} });
                return { ok: completed, ms: Date.now() - t0, tps: (completed / (Date.now() - t0) * 1000).toFixed(1), err: errors };
            })()
        `, 600000);
        const d = typeof r === 'string' ? JSON.parse(r) : r;
        console.log('  ' + label.padEnd(12) + String(d.ms).padStart(7) + 'ms   ' + d.tps.padStart(6) + '     ' + d.err);
    }

    ws.close();
    console.log('\n' + '='.repeat(70));
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
