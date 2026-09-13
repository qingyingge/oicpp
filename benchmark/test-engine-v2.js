const path = require('path');
const CompareEngineV2 = require('../src/main-process/compare-engine-v2.js').CompareEngineV2;
const PROGS = path.join(__dirname, '..', 'compare-benchmark', 'progs');

async function main() {
    console.log('=== CompareEngineV2 (Worker Threads) ===\n');

    // Test 1: Basic AC
    console.log('[T1] Sort: std::sort vs mergesort (10 tests, 2 threads)');
    {
        const e = new CompareEngineV2();
        let p = 0, err = 0, done = 0;
        e.on('progress', d => p = d.current);
        e.on('error', d => { err++; console.log('  ERROR: ' + d.message); });
        e.on('complete', d => done = d.completed);

        const t0 = Date.now();
        await e.start({
            stdExe: { executablePath: path.join(PROGS, 'sort_std') },
            testExe: { executablePath: path.join(PROGS, 'sort_mergesort') },
            generator: { executablePath: path.join(PROGS, 'gen_sort') },
            totalTests: 10, timeLimit: 5000, threadCount: 2
        });
        const ms = Date.now() - t0;
        console.log('  completed: ' + done + '/10 errors: ' + err + ' time: ' + ms + 'ms tps: ' + (done / ms * 1000).toFixed(1));
    }

    // Test 2: Stress
    console.log('\n[T2] Sort stress (50 tests, 4 threads)');
    {
        const e = new CompareEngineV2();
        let done = 0, err = 0;
        e.on('progress', d => done = d.current);
        e.on('error', d => err++);
        e.on('complete', d => done = d.completed);

        const t0 = Date.now();
        await e.start({
            stdExe: { executablePath: path.join(PROGS, 'sort_std') },
            testExe: { executablePath: path.join(PROGS, 'sort_mergesort') },
            generator: { executablePath: path.join(PROGS, 'gen_sort') },
            totalTests: 50, timeLimit: 5000, threadCount: 4
        });
        const ms = Date.now() - t0;
        console.log('  completed: ' + done + '/50 errors: ' + err + ' time: ' + ms + 'ms tps: ' + (done / ms * 1000).toFixed(1));
    }

    // Test 3: Graph
    console.log('\n[T3] Graph: Dijkstra vs SPFA (20 tests, 4 threads)');
    {
        const e = new CompareEngineV2();
        let done = 0, err = 0;
        e.on('progress', d => done = d.current);
        e.on('error', d => err++);
        e.on('complete', d => done = d.completed);

        const t0 = Date.now();
        await e.start({
            stdExe: { executablePath: path.join(PROGS, 'sp_dijkstra') },
            testExe: { executablePath: path.join(PROGS, 'sp_spfa') },
            generator: { executablePath: path.join(PROGS, 'gen_graph') },
            totalTests: 20, timeLimit: 5000, threadCount: 4
        });
        const ms = Date.now() - t0;
        console.log('  completed: ' + done + '/20 errors: ' + err + ' time: ' + ms + 'ms tps: ' + (done / ms * 1000).toFixed(1));
    }

    // Test 4: All scenarios 100 tests
    console.log('\n[T4] All scenarios (100 tests, 8 threads)');
    const scenarios = [
        ['Sort', 'gen_sort', 'sort_std', 'sort_mergesort'],
        ['Graph', 'gen_graph', 'sp_dijkstra', 'sp_spfa'],
        ['Range', 'gen_range', 'range_bit', 'range_segtree'],
    ];
    for (const [label, g, a, b] of scenarios) {
        const e = new CompareEngineV2();
        let done = 0, err = 0;
        e.on('progress', d => done = d.current);
        e.on('error', d => err++);
        e.on('complete', d => done = d.completed);

        const t0 = Date.now();
        await e.start({
            stdExe: { executablePath: path.join(PROGS, a) },
            testExe: { executablePath: path.join(PROGS, b) },
            generator: { executablePath: path.join(PROGS, g) },
            totalTests: 100, timeLimit: 10000, threadCount: 8
        });
        const ms = Date.now() - t0;
        console.log('  ' + label + ': ' + done + '/100 errors=' + err + ' ' + ms + 'ms ' + (done / ms * 1000).toFixed(1) + ' TPS');
    }

    console.log('\n=== Done ===');
}

main().catch(e => { console.error(e); process.exit(1); });
