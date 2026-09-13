const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');

const PROGS = path.join(__dirname, '..', 'compare-benchmark', 'progs');
const TMPDIR = '/tmp/oicpp_e2e_perf';
const fs = require('fs');
fs.mkdirSync(TMPDIR, { recursive: true });

function compile(name) {
    return new Promise((resolve, reject) => {
        spawn('g++', ['-O2', '-std=c++14', '-o', path.join(TMPDIR, name), path.join(PROGS, name + '.cpp')], { stdio: 'pipe' })
            .on('close', c => c === 0 ? resolve() : reject(new Error('compile ' + name)));
    });
}

function getTargets() {
    return new Promise((resolve, reject) => {
        http.get('http://127.0.0.1:9222/json', (res) => {
            let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)));
        }).on('error', reject);
    });
}

async function connectCDP() {
    const targets = await getTargets();
    const page = targets.find(t => t.type === 'page');
    if (!page) throw new Error('No page target');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise(r => ws.on('open', r));
    return ws;
}

let msgId = 1;
function cdpEval(ws, expr, timeout) {
    return new Promise((resolve, reject) => {
        const id = msgId++;
        const timer = setTimeout(() => reject(new Error('CDP eval timeout')), timeout || 60000);
        const handler = (raw) => {
            const msg = JSON.parse(raw);
            if (msg.id === id) {
                clearTimeout(timer);
                ws.removeListener('message', handler);
                if (msg.result?.exceptionDetails) reject(new Error('JS: ' + msg.result.exceptionDetails.text));
                else resolve(msg.result?.result?.value);
            }
        };
        ws.on('message', handler);
        ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true, timeout: timeout || 60000 } }));
    });
}

async function main() {
    console.log('='.repeat(65));
    console.log('  Full Electron Performance Benchmark (CDP)');
    console.log('='.repeat(65));

    console.log('\n[1] Compiling programs...');
    const names = ['gen_sort','sort_std','sort_mergesort','gen_graph','sp_dijkstra','sp_spfa','gen_range','range_bit','range_segtree'];
    for (const n of names) await compile(n);
    console.log('  OK (' + names.length + ' programs)');

    console.log('\n[2] Connecting to Electron via CDP...');
    const ws = await connectCDP();
    await cdpEval(ws, '1+1');
    console.log('  Connected');

    console.log('\n[3] Verifying IPC APIs...');
    const apiCheck = await cdpEval(ws, `JSON.stringify({
        startCompare: typeof window.electronAPI?.startCompare,
        stopCompare: typeof window.electronAPI?.stopCompare,
        onProgress: typeof window.electronAPI?.onCompareProgress,
        onError: typeof window.electronAPI?.onCompareError,
        onComplete: typeof window.electronAPI?.onCompareComplete
    })`);
    console.log('  ' + apiCheck);

    const scenarios = [
        ['Sort',  'gen_sort', 'sort_std', 'sort_mergesort'],
        ['Graph', 'gen_graph', 'sp_dijkstra', 'sp_spfa'],
        ['Range', 'gen_range', 'range_bit', 'range_segtree'],
    ];

    console.log('\n[4] Running benchmarks via Electron IPC...');
    console.log('');
    console.log('  Scenario    Tests  Workers  Latency(ms)  TPS     Errors');
    console.log('  ' + '-'.repeat(60));

    for (const [label, g, a, b] of scenarios) {
        const result = await cdpEval(ws, `
            (async () => {
                const config = {
                    stdExe: { executablePath: '${path.join(TMPDIR, a)}' },
                    testExe: { executablePath: '${path.join(TMPDIR, b)}' },
                    generator: { executablePath: '${path.join(TMPDIR, g)}' },
                    totalTests: 10,
                    timeLimit: 5000,
                    threadCount: 2,
                    useTestlib: false,
                    freopen: null
                };

                let completed = 0, errors = 0, firstProgress = 0, lastProgress = 0;
                const t0 = Date.now();

                const cleanups = [];
                cleanups.push(window.electronAPI.onCompareProgress((d) => {
                    completed = d.current;
                    lastProgress = Date.now();
                    if (firstProgress === 0) firstProgress = Date.now();
                }));
                cleanups.push(window.electronAPI.onCompareError((d) => { errors++; }));
                cleanups.push(window.electronAPI.onCompareComplete((d) => { completed = d.completed || completed; }));

                await window.electronAPI.startCompare(config);

                for (let i = 0; i < 120; i++) {
                    await new Promise(r => setTimeout(r, 500));
                    if (completed >= 10 || errors > 0) break;
                }
                cleanups.forEach(fn => { try { fn(); } catch(_) {} });

                const totalMs = Date.now() - t0;
                return { completed, errors, totalMs, tps: (completed / totalMs * 1000).toFixed(1) };
            })()
        `, 120000);

        const r = typeof result === 'string' ? JSON.parse(result) : result;
        console.log('  ' + label.padEnd(12) + '10'.padStart(3) + '    2'.padStart(2) + '       ' + String(r.totalMs).padStart(6) + '     ' + r.tps.padStart(6) + '    ' + r.errors);
    }

    console.log('');

    // Throughput test: 50 groups
    console.log('[5] Throughput stress test (50 groups, 4 workers)...');
    for (const [label, g, a, b] of scenarios) {
        const result = await cdpEval(ws, `
            (async () => {
                const config = {
                    stdExe: { executablePath: '${path.join(TMPDIR, a)}' },
                    testExe: { executablePath: '${path.join(TMPDIR, b)}' },
                    generator: { executablePath: '${path.join(TMPDIR, g)}' },
                    totalTests: 50,
                    timeLimit: 5000,
                    threadCount: 4,
                    useTestlib: false,
                    freopen: null
                };

                let completed = 0, errors = 0;
                const cleanups = [];
                cleanups.push(window.electronAPI.onCompareProgress((d) => { completed = d.current; }));
                cleanups.push(window.electronAPI.onCompareError((d) => { errors++; }));
                cleanups.push(window.electronAPI.onCompareComplete((d) => { completed = d.completed || completed; }));

                const t0 = Date.now();
                await window.electronAPI.startCompare(config);

                for (let i = 0; i < 300; i++) {
                    await new Promise(r => setTimeout(r, 500));
                    if (completed >= 50 || errors > 0) break;
                }
                cleanups.forEach(fn => { try { fn(); } catch(_) {} });

                const ms = Date.now() - t0;
                return { completed, errors, ms, tps: (completed / ms * 1000).toFixed(1) };
            })()
        `, 180000);

        const r = typeof result === 'string' ? JSON.parse(result) : result;
        console.log('  ' + label.padEnd(12) + r.completed + '/50  ' + r.tps + ' TPS  ' + r.ms + 'ms  errors=' + r.errors);
    }

    ws.close();
    console.log('\n' + '='.repeat(65));
    console.log('  Done');
    console.log('='.repeat(65));
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
