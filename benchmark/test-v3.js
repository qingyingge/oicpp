const path = require('path');
const CompareEngineV2 = require('../src/main-process/compare-engine-v2.js').CompareEngineV2;
const PROGS = path.join(__dirname, '..', 'compare-benchmark', 'progs');

async function main() {
    console.log('=== V3 Pipeline Worker (pre-spawn overlap) ===\n');
    const os = require('os');
    console.log('CPU: ' + (os.cpus()[0]?.model || '?') + ' x' + os.cpus().length + '\n');

    const scenarios = [
        ['Sort',  'gen_sort', 'sort_std', 'sort_mergesort', 10000],
        ['Graph', 'gen_graph', 'sp_dijkstra', 'sp_spfa', 5000],
        ['Range', 'gen_range', 'range_bit', 'range_segtree', 10000],
    ];

    for (const THREADS of [4, 8]) {
        console.log('--- ' + THREADS + ' threads, 50 tests ---');
        for (const [label, g, a, b, tl] of scenarios) {
            const e = new CompareEngineV2();
            let done = 0, err = 0;
            e.on('progress', d => done = d.current);
            e.on('error', d => { err++; });
            e.on('complete', d => done = d.completed);

            const t0 = Date.now();
            await e.start({
                stdExe: { executablePath: path.join(PROGS, a) },
                testExe: { executablePath: path.join(PROGS, b) },
                generator: { executablePath: path.join(PROGS, g) },
                totalTests: 50, timeLimit: tl, threadCount: THREADS
            });
            const ms = Date.now() - t0;
            console.log('  ' + label + ': ' + done + '/50 err=' + err + '  ' + ms + 'ms  ' + (done / ms * 1000).toFixed(1) + ' TPS');
        }
        console.log('');
    }
}

main().catch(e => { console.error(e); process.exit(1); });
