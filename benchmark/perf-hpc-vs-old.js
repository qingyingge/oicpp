#!/usr/bin/env node
/**
 * HPC engine vs old serial pipeline performance comparison
 */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

const PROGS = path.join(__dirname, '..', 'compare-benchmark', 'progs');

function run(exe, input, timeout) {
    return new Promise((resolve) => {
        const t0 = Date.now();
        const proc = spawn(exe, [], { stdio: ['pipe', 'pipe', 'pipe'], timeout });
        let stdout = '';
        proc.stdout.on('data', d => { stdout += d; });
        proc.stderr.on('data', () => {});
        proc.on('close', code => resolve({ out: stdout.trim(), code, ms: Date.now() - t0 }));
        proc.on('error', () => resolve({ out: '', code: -1, ms: Date.now() - t0 }));
        if (input) { try { proc.stdin.write(input); } catch(_) {} }
        proc.stdin.end();
    });
}

function match(a, b) {
    return a.trim() === b.trim();
}

async function main() {
    const cpu = os.cpus();
    console.log('='.repeat(65));
    console.log('  HPC Engine vs Old Serial Pipeline');
    console.log('='.repeat(65));
    console.log('  CPU: ' + (cpu[0]?.model || 'unknown') + ' x' + cpu.length);
    console.log('');

    const ProcessPool = require('../src/main-process/compare-pool.js');
    const CompareEngine = require('../src/main-process/compare-engine.js');

    const scenarios = [
        ['Sort',  'gen_sort', 'sort_std', 'sort_mergesort'],
        ['Graph', 'gen_graph', 'sp_dijkstra', 'sp_spfa'],
        ['Range', 'gen_range', 'range_bit', 'range_segtree'],
    ];

    // Pipeline comparison
    console.log('[1] Pipeline latency: old serial vs HPC engine (15 iters)');
    console.log('');
    console.log('      Scenario              Old Serial    HPC Engine    Speedup');
    console.log('      ' + '-'.repeat(60));

    for (const [label, g, a, b] of scenarios) {
        const genExe = path.join(PROGS, g);
        const stdExe = path.join(PROGS, a);
        const testExe = path.join(PROGS, b);

        // Old serial
        const oldTimes = [];
        for (let i = 0; i < 15; i++) {
            const t0 = Date.now();
            const genR = await run(genExe, '', 60000);
            const stdR = await run(stdExe, genR.out, 60000);
            const testR = await run(testExe, genR.out, 60000);
            oldTimes.push(Date.now() - t0);
        }
        const oldAvg = oldTimes.reduce((a, b) => a + b) / oldTimes.length;

        // HPC engine
        const hpcTimes = [];
        for (let i = 0; i < 15; i++) {
            const engine = new CompareEngine();
            let done = false;
            engine.on('complete', () => { done = true; });
            engine.on('error', () => {});
            const t0 = Date.now();
            await engine.start({
                stdExe: { executablePath: stdExe },
                testExe: { executablePath: testExe },
                generator: { executablePath: genExe },
                totalTests: 1,
                timeLimit: 60000,
                threadCount: 1,
                useTestlib: false,
                freopen: null
            });
            hpcTimes.push(Date.now() - t0);
        }
        const hpcAvg = hpcTimes.reduce((a, b) => a + b) / hpcTimes.length;
        const speedup = (oldAvg / hpcAvg).toFixed(2);
        console.log('      ' + label.padEnd(22) + oldAvg.toFixed(0).padStart(7) + 'ms    ' + hpcAvg.toFixed(0).padStart(7) + 'ms    ' + speedup + 'x');
    }
    console.log('');

    // Throughput comparison
    console.log('[2] Throughput: old serial pool vs HPC engine (50 groups)');
    console.log('');
    console.log('      Scenario    Old TPS    HPC TPS    Speedup');
    console.log('      ' + '-'.repeat(48));

    for (const [label, g, a, b] of scenarios) {
        const genExe = path.join(PROGS, g);
        const stdExe = path.join(PROGS, a);
        const testExe = path.join(PROGS, b);
        const TOTAL = 50;

        // Old serial
        let next = 0, doneOld = 0;
        const t0 = Date.now();
        const oldWorker = async () => {
            while (next < TOTAL) {
                const i = next++;
                if (i >= TOTAL) return;
                const genR = await run(genExe, '', 60000);
                const stdR = await run(stdExe, genR.out, 60000);
                const testR = await run(testExe, genR.out, 60000);
                if (match(stdR.out, testR.out)) doneOld++;
            }
        };
        await Promise.all(Array.from({ length: 4 }, oldWorker));
        const oldTps = (doneOld / (Date.now() - t0) * 1000).toFixed(1);

        // HPC engine
        const t1 = Date.now();
        const engine = new CompareEngine();
        let doneHpc = 0;
        engine.on('complete', (e) => { doneHpc = e.completed; });
        engine.on('error', () => {});
        await engine.start({
            stdExe: { executablePath: stdExe },
            testExe: { executablePath: testExe },
            generator: { executablePath: genExe },
            totalTests: TOTAL,
            timeLimit: 60000,
            threadCount: 4,
            useTestlib: false,
            freopen: null
        });
        const hpcTps = (doneHpc / (Date.now() - t1) * 1000).toFixed(1);
        const speedup = (parseFloat(hpcTps) / parseFloat(oldTps)).toFixed(2);
        console.log('      ' + label.padEnd(12) + oldTps.padStart(7) + '     ' + hpcTps.padStart(7) + '     ' + speedup + 'x');
    }
    console.log('');
    console.log('='.repeat(65));
}

main().catch(e => { console.error(e); process.exit(1); });
