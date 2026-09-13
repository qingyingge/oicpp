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
    console.log('='.repeat(65));
    console.log('  V2 Electron Benchmark (Worker Threads)');
    console.log('  CPU: ' + (os.cpus()[0]?.model || '?') + ' x' + os.cpus().length);
    console.log('='.repeat(65));

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
    console.log('  Connected');

    const hasV2 = await cdpEval(ws, 'typeof window.electronAPI?.startCompare === "function"');
    console.log('  startCompare: ' + hasV2);

    const scenarios = [
        ['Sort',  'gen_sort', 'sort_std', 'sort_mergesort'],
        ['Graph', 'gen_graph', 'sp_dijkstra', 'sp_spfa'],
        ['Range', 'gen_range', 'range_bit', 'range_segtree'],
    ];

    for (const THREADS of [2, 4, 8]) {
        console.log('\n[3] ' + THREADS + ' threads, 20 tests per scenario');
        console.log('');
        console.log('  Scenario    Tests  Threads  Time(ms)    TPS     Errors');
        console.log('  ' + '-'.repeat(58));

        for (const [label, g, a, b] of scenarios) {
            const result = await cdpEval(ws, `
                (async () => {
                    let completed = 0, errors = 0;
                    const cleanups = [];
                    cleanups.push(window.electronAPI.onCompareProgress((d) => { completed = d.current; }));
                    cleanups.push(window.electronAPI.onCompareError((d) => { errors++; }));
                    cleanups.push(window.electronAPI.onCompareComplete((d) => { completed = d.completed || completed; }));

                    const t0 = Date.now();
                    await window.electronAPI.startCompare({
                        stdExe: { executablePath: '${path.join(TMPDIR, a)}' },
                        testExe: { executablePath: '${path.join(TMPDIR, b)}' },
                        generator: { executablePath: '${path.join(TMPDIR, g)}' },
                        totalTests: 20,
                        timeLimit: 5000,
                        threadCount: ${THREADS},
                        useTestlib: false,
                        freopen: null
                    });

                    for (let i = 0; i < 120; i++) {
                        await new Promise(r => setTimeout(r, 500));
                        if (completed >= 20 || errors > 0) break;
                    }
                    cleanups.forEach(fn => { try { fn(); } catch(_) {} });
                    const ms = Date.now() - t0;
                    return { ok: completed, err: errors, ms, tps: (completed / ms * 1000).toFixed(1) };
                })()
            `, 180000);
            const r = typeof result === 'string' ? JSON.parse(result) : result;
            console.log('  ' + label.padEnd(12) + '20'.padStart(3) + '    ' + String(THREADS).padStart(2) + '       ' + String(r.ms).padStart(7) + '   ' + r.tps.padStart(6) + '     ' + r.err);
        }
    }

    ws.close();
    console.log('\n' + '='.repeat(65));
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
