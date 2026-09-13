const path = require('path');
const { Worker } = require('worker_threads');
const PROGS = path.join(__dirname, '..', 'compare-benchmark', 'progs');

function runWorker(workerFile, threads, totalTests, g, a, b, timeLimit) {
    return new Promise((resolve, reject) => {
        const t0 = Date.now();
        let done = 0, err = 0;
        const w = new Worker(workerFile);
        w.on('message', (m) => {
            if (m.type === 'progress') done++;
            else if (m.type === 'error') { err++; }
            else if (m.type === 'done') { w.terminate(); resolve({ done, err, ms: Date.now() - t0, tps: done / (Date.now() - t0) * 1000 }); }
        });
        w.on('error', reject);
        const per = Math.ceil(totalTests / threads);
        for (let i = 0; i < threads; i++) {
            w.postMessage({ type: 'run-tests', startIdx: i * per, count: Math.min(per, totalTests - i * per), genPath: path.join(PROGS, g), stdPath: path.join(PROGS, a), testPath: path.join(PROGS, b), timeout: timeLimit });
        }
    });
}

async function main() {
    const os = require('os');
    console.log('V3 vs V6 — Node direct, CPU x' + os.cpus().length + '\n');
    const scenarios = [
        ['Sort',  'gen_sort', 'sort_std', 'sort_mergesort', 10000],
        ['Graph', 'gen_graph', 'sp_dijkstra', 'sp_spfa', 5000],
        ['Range', 'gen_range', 'range_bit', 'range_segtree', 10000],
    ];
    const v3 = path.join(__dirname, '..', 'src', 'main-process', 'compare-worker.js');
    const v6 = path.join(__dirname, '..', 'src', 'main-process', 'compare-worker-v8.js');

    for (const THREADS of [2, 4, 6]) {
        console.log('=== ' + THREADS + ' threads, 50 tests ===');
        console.log('Scenario   V3(TPS)   V6(TPS)   V3(ms)    V6(ms)');
        for (const [label, g, a, b, tl] of scenarios) {
            const r3 = await runWorker(v3, THREADS, 50, g, a, b, tl);
            const r6 = await runWorker(v6, THREADS, 50, g, a, b, tl);
            console.log(label.padEnd(9) + '  ' + r3.tps.toFixed(1).padStart(5) + '    ' + r6.tps.toFixed(1).padStart(5) +
                '   ' + String(r3.ms).padStart(6) + '   ' + String(r6.ms).padStart(6) + '   err: ' + r3.err + '/' + r6.err);
        }
        console.log('');
    }
}

main().catch(e => { console.error(e); process.exit(1); });
