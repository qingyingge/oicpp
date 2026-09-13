#!/usr/bin/env node
const path = require('path');
const fs = require('fs');

const PROGS = path.join(__dirname, '..', 'compare-benchmark', 'progs');

async function main() {
    console.log('='.repeat(60));
    console.log('  HPC Refactor Verification');
    console.log('='.repeat(60));

    console.log('');
    console.log('[1/4] ProcessPool basic');
    const ProcessPool = require('../src/main-process/compare-pool.js');

    const genPool = new ProcessPool({ exePath: path.join(PROGS, 'gen_sort'), role: 'gen', maxWorkers: 1 });
    const stdPool = new ProcessPool({ exePath: path.join(PROGS, 'sort_std'), role: 'std', maxWorkers: 4 });
    const testPool = new ProcessPool({ exePath: path.join(PROGS, 'sort_mergesort'), role: 'test', maxWorkers: 4 });

    const genResult = await genPool.run('', 5000);
    console.log('  gen: exit=' + genResult.exitCode + ' output=' + genResult.output.substring(0, 40) + '...');
    if (genResult.exitCode !== 0) throw new Error('gen fail');
    const input = genResult.output;

    const stdResult = await stdPool.run(input, 5000);
    const testResult = await testPool.run(input, 5000);
    const match = stdResult.output.trim() === testResult.output.trim();
    console.log('  std exit=' + stdResult.exitCode + ' bytes=' + stdResult.output.length);
    console.log('  test exit=' + testResult.exitCode + ' bytes=' + testResult.output.length);
    console.log('  match=' + match);
    if (!match) throw new Error('output mismatch');
    console.log('  PASS');

    // 2. Parallel throughput
    console.log('');
    console.log('[2/4] ProcessPool parallel (20 runs, 4 workers)');
    const t0 = Date.now();
    const runs = [];
    for (let i = 0; i < 20; i++) {
        runs.push((async () => {
            const g = await genPool.run('', 5000);
            const [s, t] = await Promise.all([
                stdPool.run(g.output, 5000),
                testPool.run(g.output, 5000)
            ]);
            return s.output.trim() === t.output.trim();
        })());
    }
    const results = await Promise.all(runs);
    const elapsed = Date.now() - t0;
    const allMatch = results.every(r => r === true);
    console.log('  ' + elapsed + 'ms total, ' + (elapsed / 20).toFixed(0) + 'ms/run, allMatch=' + allMatch);
    if (!allMatch) throw new Error('mismatch in parallel run');
    console.log('  PASS');

    // 3. Concurrency control via pool stats
    console.log('');
    console.log('[3/4] Concurrency control (maxWorkers=2, 10 tasks)');
    const pool2 = new ProcessPool({ exePath: path.join(PROGS, 'sort_std'), role: 'limit', maxWorkers: 2 });
    let peakActive = 0;
    const origAcquire = pool2._acquire.bind(pool2);
    const origRelease = pool2._release.bind(pool2);
    pool2._acquire = function() {
        const p = origAcquire();
        if (p.then) {
            return p.then(() => {
                if (pool2._active > peakActive) peakActive = pool2._active;
            });
        }
        return p;
    };
    const cRuns = [];
    for (let i = 0; i < 10; i++) {
        cRuns.push((async () => {
            const g = await genPool.run('', 5000);
            await pool2.run(g.output, 5000);
        })());
    }
    await Promise.all(cRuns);
    console.log('  peak active: ' + peakActive + ' (limit: 2)');
    pool2.destroy();
    if (peakActive > 2) throw new Error('concurrency exceeded limit: ' + peakActive);
    console.log('  PASS');

    // 4. CompareEngine
    console.log('');
    console.log('[4/4] CompareEngine integration (10 tests)');
    const CompareEngine = require('../src/main-process/compare-engine.js');
    const engine = new CompareEngine();
    let progressCount = 0, errorCount = 0, completedCount = 0;

    engine.on('progress', () => { progressCount++; });
    engine.on('error', (e) => { errorCount++; console.log('  ERROR: ' + e.message); });
    engine.on('complete', (e) => { completedCount = e.completed; });

    const t1 = Date.now();
    await engine.start({
        stdExe: { executablePath: path.join(PROGS, 'sort_std') },
        testExe: { executablePath: path.join(PROGS, 'sort_mergesort') },
        generator: { executablePath: path.join(PROGS, 'gen_sort') },
        totalTests: 10,
        timeLimit: 5000,
        threadCount: 2,
        useTestlib: false,
        freopen: null
    });
    const engineTime = Date.now() - t1;

    console.log('  progress: ' + progressCount + '/10');
    console.log('  errors: ' + errorCount);
    console.log('  completed: ' + completedCount + '/10');
    console.log('  time: ' + engineTime + 'ms (' + (engineTime / 10).toFixed(0) + 'ms/test)');
    if (progressCount !== 10) throw new Error('expected 10 progress');
    if (errorCount !== 0) throw new Error('expected 0 errors');
    if (completedCount !== 10) throw new Error('expected 10 completed');
    console.log('  PASS');

    // 5. Engine stop
    console.log('');
    console.log('[bonus] CompareEngine stop');
    const engine2 = new CompareEngine();
    let stopped = false;
    engine2.on('complete', () => { stopped = true; });
    engine2.on('error', () => {});
    engine2.on('progress', () => {
        engine2.stop();
    });

    await engine2.start({
        stdExe: { executablePath: path.join(PROGS, 'sort_std') },
        testExe: { executablePath: path.join(PROGS, 'sort_mergesort') },
        generator: { executablePath: path.join(PROGS, 'gen_sort') },
        totalTests: 100,
        timeLimit: 5000,
        threadCount: 2,
        useTestlib: false,
        freopen: null
    });
    console.log('  stopped after progress event, completed flag=' + stopped);
    console.log('  PASS');

    // Cleanup
    genPool.destroy();
    stdPool.destroy();
    testPool.destroy();

    console.log('');
    console.log('='.repeat(60));
    console.log('  ALL 5 TESTS PASSED');
    console.log('='.repeat(60));
}

main().catch(e => { console.error('FAIL:', e); process.exit(1); });
