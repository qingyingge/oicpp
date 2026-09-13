#!/usr/bin/env node
/**
 * Same Electron process, same test programs, same data:
 *   OLD: runProgram() × 30+ IPC per test
 *   NEW: startCompare() × 1 IPC per test
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PROGS = path.join(__dirname, '..', 'compare-benchmark', 'progs');
const TMPDIR = '/tmp/oicpp_e2e_compare';
fs.mkdirSync(TMPDIR, { recursive: true });

let msgId = 1;
function cdpEval(ws, expr, timeout) {
    return new Promise((resolve, reject) => {
        const id = msgId++;
        const timer = setTimeout(() => reject(new Error('CDP timeout')), timeout || 120000);
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
        ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true, timeout: timeout || 120000 } }));
    });
}

async function main() {
    console.log('='.repeat(70));
    console.log('  SAME Electron, SAME test programs: OLD vs NEW architecture');
    console.log('='.repeat(70));

    // Compile
    console.log('\n[1] Compiling...');
    const { spawn } = require('child_process');
    const names = ['gen_sort','sort_std','sort_mergesort','gen_graph','sp_dijkstra','sp_spfa','gen_range','range_bit','range_segtree'];
    for (const n of names) {
        await new Promise((resolve, reject) => {
            spawn('g++', ['-O2', '-std=c++14', '-o', path.join(TMPDIR, n), path.join(PROGS, n + '.cpp')], { stdio: 'pipe' })
                .on('close', c => c === 0 ? resolve() : reject(new Error('compile ' + n)));
        });
    }
    console.log('  OK');

    // Connect
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

    // Check what APIs exist
    const hasNewAPI = await cdpEval(ws, 'typeof window.electronAPI?.startCompare === "function"');
    const hasOldAPI = await cdpEval(ws, 'typeof window.electronAPI?.runProgram === "function"');
    console.log('  startCompare: ' + hasNewAPI + ', runProgram: ' + hasOldAPI);

    const scenarios = [
        ['Sort',  'gen_sort', 'sort_std', 'sort_mergesort'],
        ['Graph', 'gen_graph', 'sp_dijkstra', 'sp_spfa'],
        ['Range', 'gen_range', 'range_bit', 'range_segtree'],
    ];

    const TOTAL = 20;

    // ─── OLD: runProgram × 30+ IPC ───
    if (hasOldAPI) {
        console.log('\n[3] OLD: runProgram() — ' + TOTAL + ' tests, 4 workers, ~15 IPC calls/test');
        console.log('');
        console.log('  Scenario    Tests  Workers  Time(ms)    TPS');
        console.log('  ' + '-'.repeat(50));

        for (const [label, g, a, b] of scenarios) {
            const result = await cdpEval(ws, `
                (async () => {
                    const genExe = '${path.join(TMPDIR, g)}';
                    const stdExe = '${path.join(TMPDIR, a)}';
                    const testExe = '${path.join(TMPDIR, b)}';
                    const TOTAL = ${TOTAL};
                    let next = 0, ok = 0, err = 0;

                    const worker = async () => {
                        while (true) {
                            const i = next++;
                            if (i >= TOTAL) return;
                            try {
                                const gen = await window.electronAPI.runProgram(genExe, '', 5000);
                                if (gen.exitCode !== 0) { err++; continue; }
                                const input = (gen.stdout || gen.output || '').trim();

                                const std = await window.electronAPI.runProgram(stdExe, input, 5000);
                                if (std.exitCode !== 0) { err++; continue; }

                                const test = await window.electronAPI.runProgram(testExe, input, 5000);
                                if (test.exitCode !== 0) { err++; continue; }

                                ok++;
                            } catch(e) { err++; }
                        }
                    };

                    const t0 = Date.now();
                    await Promise.all(Array.from({ length: 4 }, worker));
                    const ms = Date.now() - t0;
                    return { ok, err, ms, tps: (ok / ms * 1000).toFixed(1) };
                })()
            `, 300000);
            const r = typeof result === 'string' ? JSON.parse(result) : result;
            console.log('  ' + label.padEnd(12) + String(TOTAL).padStart(3) + '    4       ' + String(r.ms).padStart(7) + '   ' + r.tps.padStart(6));
        }
    }

    // ─── NEW: startCompare × 1 IPC ───
    if (hasNewAPI) {
        console.log('\n[4] NEW: startCompare() — ' + TOTAL + ' tests, 4 workers, 1 IPC call total');
        console.log('');
        console.log('  Scenario    Tests  Workers  Time(ms)    TPS');
        console.log('  ' + '-'.repeat(50));

        for (const [label, g, a, b] of scenarios) {
            const result = await cdpEval(ws, `
                (async () => {
                    let completed = 0, errors = 0;
                    const cleanups = [];
                    cleanups.push(window.electronAPI.onCompareProgress((d) => { completed = d.current; }));
                    cleanups.push(window.electronAPI.onCompareError(() => { errors++; }));
                    cleanups.push(window.electronAPI.onCompareComplete((d) => { completed = d.completed || completed; }));

                    const t0 = Date.now();
                    await window.electronAPI.startCompare({
                        stdExe: { executablePath: '${path.join(TMPDIR, a)}' },
                        testExe: { executablePath: '${path.join(TMPDIR, b)}' },
                        generator: { executablePath: '${path.join(TMPDIR, g)}' },
                        totalTests: ${TOTAL},
                        timeLimit: 5000,
                        threadCount: 4,
                        useTestlib: false,
                        freopen: null
                    });

                    for (let i = 0; i < 120; i++) {
                        await new Promise(r => setTimeout(r, 500));
                        if (completed >= ${TOTAL} || errors > 0) break;
                    }
                    cleanups.forEach(fn => { try { fn(); } catch(_) {} });
                    const ms = Date.now() - t0;
                    return { ok: completed, err: errors, ms, tps: (completed / ms * 1000).toFixed(1) };
                })()
            `, 120000);
            const r = typeof result === 'string' ? JSON.parse(result) : result;
            console.log('  ' + label.padEnd(12) + String(TOTAL).padStart(3) + '    4       ' + String(r.ms).padStart(7) + '   ' + r.tps.padStart(6));
        }
    }

    ws.close();
    console.log('\n' + '='.repeat(70));
    console.log('  Compare [3] vs [4] rows');
    console.log('='.repeat(70));
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
