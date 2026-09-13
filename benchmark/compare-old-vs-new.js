#!/usr/bin/env node
/**
 * Old vs New architecture comparison
 * Old: 30+ IPC calls per test (renderer -> main -> spawn -> IPC -> renderer)
 * New: 1 IPC call per test (renderer -> CompareEngine -> ProcessPool)
 *
 * This script measures the overhead by simulating both architectures.
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PROGS = path.join(__dirname, '..', 'compare-benchmark', 'progs');
const TMPDIR = '/tmp/oicpp_e2e_compare';
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

let msgId = 1;
function cdpEval(ws, expr, timeout) {
    return new Promise((resolve, reject) => {
        const id = msgId++;
        const timer = setTimeout(() => reject(new Error('CDP timeout')), timeout || 60000);
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
        ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true, timeout: timeout || 60000 } }));
    });
}

async function main() {
    const WebSocket = require('ws');
    console.log('='.repeat(65));
    console.log('  Old vs New Architecture: Full Electron Benchmark');
    console.log('='.repeat(65));

    // Compile
    console.log('\n[1] Compiling...');
    const names = ['gen_sort','sort_std','sort_mergesort','gen_graph','sp_dijkstra','sp_spfa','gen_range','range_bit','range_segtree'];
    for (const n of names) await compile(n);
    console.log('  OK');

    // Connect CDP
    console.log('\n[2] Connecting...');
    const targets = await getTargets();
    const page = targets.find(t => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise(r => ws.on('open', r));
    await cdpEval(ws, '1+1');
    console.log('  Connected');

    const scenarios = [
        ['Sort',  'gen_sort', 'sort_std', 'sort_mergesort'],
        ['Graph', 'gen_graph', 'sp_dijkstra', 'sp_spfa'],
        ['Range', 'gen_range', 'range_bit', 'range_segtree'],
    ];

    // ─── Test NEW architecture (CompareEngine via 1 IPC) ───
    console.log('\n[3] NEW architecture: CompareEngine (1 IPC call per test)');
    console.log('');
    console.log('  Scenario    Tests  Workers  Time(ms)    TPS');
    console.log('  ' + '-'.repeat(50));

    for (const [label, g, a, b] of scenarios) {
        const result = await cdpEval(ws, `
            (async () => {
                const config = {
                    stdExe: { executablePath: '${path.join(TMPDIR, a)}' },
                    testExe: { executablePath: '${path.join(TMPDIR, b)}' },
                    generator: { executablePath: '${path.join(TMPDIR, g)}' },
                    totalTests: 20,
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

                for (let i = 0; i < 120; i++) {
                    await new Promise(r => setTimeout(r, 500));
                    if (completed >= 20 || errors > 0) break;
                }
                cleanups.forEach(fn => { try { fn(); } catch(_) {} });
                const ms = Date.now() - t0;
                return { completed, errors, ms, tps: (completed / ms * 1000).toFixed(1) };
            })()
        `, 120000);

        const r = typeof result === 'string' ? JSON.parse(result) : result;
        console.log('  ' + label.padEnd(12) + '20'.padStart(3) + '    4'.padStart(2) + '       ' + String(r.ms).padStart(7) + '   ' + r.tps.padStart(6));
        if (r.errors > 0) console.log('    ERRORS: ' + r.errors);
    }

    // ─── Test OLD architecture (simulate 30+ IPC calls per test) ───
    console.log('\n[4] OLD architecture: simulated (30+ IPC calls per test via runProgram)');
    console.log('');
    console.log('  Scenario    Tests  Workers  Time(ms)    TPS');
    console.log('  ' + '-'.repeat(50));

    for (const [label, g, a, b] of scenarios) {
        const result = await cdpEval(ws, `
            (async () => {
                const genPath = '${path.join(TMPDIR, g)}';
                const stdPath = '${path.join(TMPDIR, a)}';
                const testPath = '${path.join(TMPDIR, b)}';
                const TOTAL = 20;
                let nextIdx = 0, completed = 0, errors = 0;

                const worker = async () => {
                    while (nextIdx < TOTAL) {
                        const i = nextIdx++;
                        if (i >= TOTAL) return;
                        try {
                            // Simulate OLD: 30+ IPC calls per test
                            const genResult = await window.electronAPI.runProgram(genPath, '', 5000);
                            if (genResult.exitCode !== 0) { errors++; return; }
                            const input = genResult.stdout || genResult.output || '';

                            // prepareFreopen (IPC)
                            await window.electronAPI.ensureDir('/tmp/_old_freopen_std');
                            const stdInput = '/tmp/_old_freopen_std/input.txt';
                            await window.electronAPI.writeFile(stdInput, input);

                            // runProgram std (IPC)
                            const stdResult = await window.electronAPI.runProgram(stdPath, input, 5000);
                            if (stdResult.exitCode !== 0) { errors++; return; }

                            // cleanup std (IPC)
                            await window.electronAPI.checkFileExists(stdInput);
                            try { await window.electronAPI.deleteFile(stdInput); } catch(_) {}

                            // prepareFreopen test (IPC)
                            await window.electronAPI.ensureDir('/tmp/_old_freopen_test');
                            const testInput = '/tmp/_old_freopen_test/input.txt';
                            await window.electronAPI.writeFile(testInput, input);

                            // runProgram test (IPC)
                            const testResult = await window.electronAPI.runProgram(testPath, input, 5000);
                            if (testResult.exitCode !== 0) { errors++; return; }

                            // cleanup test (IPC)
                            await window.electronAPI.checkFileExists(testInput);
                            try { await window.electronAPI.deleteFile(testInput); } catch(_) {}

                            // pathJoin x4 (IPC)
                            await window.electronAPI.pathJoin('/tmp', 'a', 'b');
                            await window.electronAPI.pathJoin('/tmp', 'c', 'd');
                            await window.electronAPI.pathJoin('/tmp', 'e', 'f');
                            await window.electronAPI.pathJoin('/tmp', 'g', 'h');

                            completed++;
                        } catch(e) { errors++; }
                    }
                };

                const t0 = Date.now();
                await Promise.all(Array.from({ length: 4 }, worker));
                const ms = Date.now() - t0;
                return { completed, errors, ms, tps: (completed / ms * 1000).toFixed(1) };
            })()
        `, 300000);

        const r = typeof result === 'string' ? JSON.parse(result) : result;
        console.log('  ' + label.padEnd(12) + '20'.padStart(3) + '    4'.padStart(2) + '       ' + String(r.ms).padStart(7) + '   ' + r.tps.padStart(6));
        if (r.errors > 0) console.log('    ERRORS: ' + r.errors);
    }

    ws.close();
    console.log('\n' + '='.repeat(65));
    console.log('  Done — compare OLD vs NEW rows above');
    console.log('='.repeat(65));
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
