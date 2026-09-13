#!/usr/bin/env node
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
    console.log('='.repeat(65));
    console.log('  OLD Architecture: simulating 30+ IPC calls per test');
    console.log('='.repeat(65));

    console.log('\n[1] Compiling...');
    const names = ['gen_sort','sort_std','sort_mergesort','gen_graph','sp_dijkstra','sp_spfa','gen_range','range_bit','range_segtree'];
    for (const n of names) await compile(n);
    console.log('  OK');

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

    console.log('\n[3] Running OLD architecture (20 tests, 4 workers)...');
    console.log('');
    console.log('  Scenario    Tests  Workers  Time(ms)    TPS     IPC calls/test');
    console.log('  ' + '-'.repeat(65));

    for (const [label, g, a, b] of scenarios) {
        const result = await cdpEval(ws, `
            (async () => {
                const genPath = '${path.join(TMPDIR, g)}';
                const stdPath = '${path.join(TMPDIR, a)}';
                const testPath = '${path.join(TMPDIR, b)}';
                const TOTAL = 20;
                let nextIdx = 0, completed = 0, errors = 0, totalIpc = 0;

                const worker = async () => {
                    while (true) {
                        const i = nextIdx++;
                        if (i >= TOTAL) return;
                        try {
                            let ipcCount = 0;

                            const genResult = await window.electronAPI.runProgram(genPath, '', 5000);
                            ipcCount++;
                            if (genResult.exitCode !== 0) { errors++; return; }
                            const input = (genResult.stdout || genResult.output || '').trim();

                            await window.electronAPI.ensureDir('/tmp/_old_freopen_' + i);
                            ipcCount++;
                            await window.electronAPI.pathJoin('/tmp', '_old_freopen_' + i, 'input.txt');
                            ipcCount++;
                            await window.electronAPI.pathJoin('/tmp', '_old_freopen_' + i, 'output.txt');
                            ipcCount++;

                            const stdResult = await window.electronAPI.runProgram(stdPath, input, 5000);
                            ipcCount++;
                            if (stdResult.exitCode !== 0) { errors++; return; }

                            const stdExists = await window.electronAPI.checkFileExists('/tmp/_old_freopen_' + i + '/output.txt');
                            ipcCount++;
                            if (stdExists) { try { await window.electronAPI.deleteFile('/tmp/_old_freopen_' + i + '/output.txt'); } catch(_) {} ipcCount++; }

                            await window.electronAPI.ensureDir('/tmp/_old_freopen_test_' + i);
                            ipcCount++;
                            await window.electronAPI.pathJoin('/tmp', '_old_freopen_test_' + i, 'input.txt');
                            ipcCount++;
                            await window.electronAPI.pathJoin('/tmp', '_old_freopen_test_' + i, 'output.txt');
                            ipcCount++;

                            const testResult = await window.electronAPI.runProgram(testPath, input, 5000);
                            ipcCount++;
                            if (testResult.exitCode !== 0) { errors++; return; }

                            const testExists = await window.electronAPI.checkFileExists('/tmp/_old_freopen_test_' + i + '/output.txt');
                            ipcCount++;
                            if (testExists) { try { await window.electronAPI.deleteFile('/tmp/_old_freopen_test_' + i + '/output.txt'); } catch(_) {} ipcCount++; }

                            totalIpc += ipcCount;
                            completed++;
                        } catch(e) { errors++; }
                    }
                };

                const t0 = Date.now();
                await Promise.all(Array.from({ length: 4 }, worker));
                const ms = Date.now() - t0;
                const avgIpc = completed > 0 ? Math.round(totalIpc / completed) : 0;
                return { completed, errors, ms, tps: (completed / ms * 1000).toFixed(1), avgIpc };
            })()
        `, 300000);

        const r = typeof result === 'string' ? JSON.parse(result) : result;
        console.log('  ' + label.padEnd(12) + '20'.padStart(3) + '    4'.padStart(2) + '       ' + String(r.ms).padStart(7) + '   ' + r.tps.padStart(6) + '        ' + r.avgIpc);
        if (r.errors > 0) console.log('    ERRORS: ' + r.errors);
    }

    ws.close();
    console.log('\n' + '='.repeat(65));
    console.log('  Done');
    console.log('='.repeat(65));
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
