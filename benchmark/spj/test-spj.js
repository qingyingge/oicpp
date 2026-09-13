/**
 * test-spj.js — SPJ (Special Judge) benchmark across 3 engines
 *
 * 流程: gen_sort → sort_std (expected) → sort_mergesort (actual) → SPJ diff
 * 三引擎: 原版spawn串行 / V3 worker / V10 native worker
 * 每引擎50测试，记录AC/耗时/TPS/WA误判/超时挂死
 *
 * 用法: node benchmark/spj/test-spj.js [--quick]
 */
const path = require('path');
const { spawn } = require('child_process');
const { Worker } = require('worker_threads');
const os = require('os');

const PROGS = path.join(__dirname, '..', '..', 'compare-benchmark', 'progs');
const SPJ_BIN = path.join(__dirname, 'spj_diff');
const QUICK = process.argv.includes('--quick');
const TOTAL = QUICK ? 10 : 50;
const THREADS = 4;
const GEN_TIMEOUT = 5000;
const RUN_TIMEOUT = 10000;
const SPJ_TIMEOUT = 5000;

// ── Utility ──
function runProgram(exePath, input, timeout) {
    return new Promise((resolve) => {
        const t0 = Date.now();
        let child;
        try {
            child = spawn(exePath, [], { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
        } catch (e) {
            return resolve({ code: -1, error: e.message, ms: 0, timeout: false, output: Buffer.alloc(0) });
        }
        const stdoutChunks = [];
        let killed = false, settled = false;
        const timer = setTimeout(() => {
            killed = true;
            try { child.kill('SIGKILL'); } catch (_) {}
        }, timeout || 60000);
        child.stdout.on('data', (c) => { if (!killed) stdoutChunks.push(c); });
        child.stderr.on('data', () => {});
        child.on('error', (e) => {
            if (!settled) { settled = true; clearTimeout(timer);
                resolve({ code: -1, error: e.message, ms: Date.now() - t0, timeout: killed, output: Buffer.alloc(0) }); }
        });
        child.on('close', (code) => {
            if (!settled) { settled = true; clearTimeout(timer);
                resolve({ code, ms: Date.now() - t0, timeout: killed, output: Buffer.concat(stdoutChunks), error: killed ? 'TLE' : null }); }
        });
        if (input && input.length > 0) child.stdin.write(input);
        child.stdin.end();
    });
}

function buildSpjInput(expectedBuf, actualBuf) {
    const N = Buffer.from(String(expectedBuf.length) + '\n');
    return Buffer.concat([N, expectedBuf, actualBuf]);
}

// ── Generate test data: gen_sort → sort_std (expected) → sort_mergesort (actual) ──
// Pre-generate all test data upfront to avoid I/O during timing
async function generateTestData(count) {
    const tests = [];
    for (let i = 0; i < count; i++) {
        const genR = await runProgram(path.join(PROGS, 'gen_sort'), '', GEN_TIMEOUT);
        if (genR.timeout || genR.error || genR.code !== 0) {
            throw new Error(`gen_sort failed on test ${i}: code=${genR.code} err=${genR.error}`);
        }
        const input = genR.output;

        const stdR = await runProgram(path.join(PROGS, 'sort_std'), input, RUN_TIMEOUT);
        if (stdR.timeout || stdR.error || stdR.code !== 0) {
            throw new Error(`sort_std failed on test ${i}: code=${stdR.code}`);
        }

        const testR = await runProgram(path.join(PROGS, 'sort_mergesort'), input, RUN_TIMEOUT);
        if (testR.timeout || testR.error || testR.code !== 0) {
            throw new Error(`sort_mergesort failed on test ${i}: code=${testR.code}`);
        }

        tests.push({
            expected: stdR.output,
            actual: testR.output,
            spjInput: buildSpjInput(stdR.output, testR.output)
        });
        process.stdout.write(`\r  Generating test data: ${i + 1}/${count}`);
    }
    console.log('');
    return tests;
}

// ── Engine A: Original child_process spawn (serial SPJ) ──
async function engineOriginal(tests) {
    let ac = 0, wa = 0, tle = 0, oth = 0;
    const t0 = Date.now();
    for (let i = 0; i < tests.length; i++) {
        const r = await runProgram(SPJ_BIN, tests[i].spjInput, SPJ_TIMEOUT);
        if (r.timeout) { tle++; continue; }
        if (r.error && r.error !== 'TLE') { oth++; continue; }
        if (r.code === 0) ac++;
        else if (r.code === 1) wa++;
        else oth++;
    }
    const wallMs = Date.now() - t0;
    return { ac, wa, tle, oth, wallMs, tps: ac / wallMs * 1000 };
}

// ── Engine B/C: Worker-based SPJ ──
function engineWorker(workerFile, tests, threads) {
    return new Promise((resolve) => {
        const t0 = Date.now();
        let ac = 0, wa = 0, tle = 0, oth = 0, done = 0;
        const total = tests.length;
        const workers = [];

        for (let w = 0; w < threads; w++) {
            const worker = new Worker(workerFile);
            workers.push(worker);
            worker.on('message', (m) => {
                if (m.type === 'spj-result') {
                    done++;
                    if (m.verdict === 'AC') ac++;
                    else if (m.verdict === 'WA') wa++;
                    else if (m.verdict === 'TLE') tle++;
                    else oth++;
                    if (done === total) {
                        const wallMs = Date.now() - t0;
                        workers.forEach(wk => wk.terminate());
                        resolve({ ac, wa, tle, oth, wallMs, tps: ac / wallMs * 1000 });
                    }
                } else if (m.type === 'spj-error') {
                    done++;
                    oth++;
                    if (done === total) {
                        const wallMs = Date.now() - t0;
                        workers.forEach(wk => wk.terminate());
                        resolve({ ac, wa, tle, oth, wallMs, tps: ac / wallMs * 1000 });
                    }
                } else if (m.type === 'ready') {
                    // Worker ready, send work
                }
            });
            worker.on('error', () => {
                done++;
                oth++;
                if (done === total) {
                    const wallMs = Date.now() - t0;
                    workers.forEach(wk => wk.terminate());
                    resolve({ ac, wa, tle, oth, wallMs, tps: 0 });
                }
            });
        }

        // Distribute tests to workers (each worker gets a batch)
        const perWorker = Math.ceil(total / threads);
        for (let w = 0; w < threads; w++) {
            const start = w * perWorker;
            const count = Math.min(perWorker, total - start);
            if (count <= 0) continue;
            const batch = [];
            for (let i = start; i < start + count; i++) {
                batch.push({ index: i, spjInput: tests[i].spjInput });
            }
            workers[w].postMessage({ type: 'run-spj', spjBin: SPJ_BIN, tests: batch, timeout: SPJ_TIMEOUT });
        }
    });
}

// ── Worker file for V3 engine (child_process spawn in worker) ──
function createV3WorkerFile() {
    return path.join(__dirname, 'spj-worker-v3.js');
}

// ── Worker file for V10 engine (fastspawn.node in worker) ──
function createV10WorkerFile() {
    return path.join(__dirname, 'spj-worker-v10.js');
}

// ── Baseline: full comparison without SPJ (gen+std+test parallel) ──
function runBaselineWorker(workerFile, threads, totalTests) {
    return new Promise((resolve) => {
        const t0 = Date.now();
        let done = 0, err = 0;
        const workers = [];
        for (let w = 0; w < threads; w++) {
            const worker = new Worker(workerFile);
            workers.push(worker);
            worker.on('message', (m) => {
                if (m.type === 'progress') done++;
                else if (m.type === 'error') err++;
                else if (m.type === 'done') {
                    // Don't terminate yet, wait for all
                }
            });
            worker.on('error', () => err++);
        }

        const perWorker = Math.ceil(totalTests / threads);
        let allDone = false;
        const checkDone = () => {
            if (allDone) return;
            if (done + err >= totalTests) {
                allDone = true;
                const wallMs = Date.now() - t0;
                workers.forEach(wk => wk.terminate());
                resolve({ done, err, wallMs, tps: done / wallMs * 1000 });
            }
        };

        for (let w = 0; w < threads; w++) {
            const start = w * perWorker;
            const count = Math.min(perWorker, totalTests - start);
            if (count <= 0) continue;
            workers[w].postMessage({
                type: 'run-tests',
                startIdx: start,
                count,
                genPath: path.join(PROGS, 'gen_sort'),
                stdPath: path.join(PROGS, 'sort_std'),
                testPath: path.join(PROGS, 'sort_mergesort'),
                timeout: RUN_TIMEOUT
            });
            workers[w].on('message', (m) => {
                if (m.type === 'progress') checkDone();
                else if (m.type === 'error') checkDone();
                else if (m.type === 'done') checkDone();
            });
        }

        setTimeout(() => {
            if (!allDone) {
                allDone = true;
                const wallMs = Date.now() - t0;
                workers.forEach(wk => wk.terminate());
                resolve({ done, err, wallMs, tps: done / wallMs * 1000 });
            }
        }, 300000);
    });
}

// ── Main ──
async function main() {
    console.log('== SPJ (Special Judge) Benchmark ==');
    console.log('CPU: ' + (os.cpus()[0]?.model || '?') + ' x' + os.cpus().length);
    console.log('Tests: ' + TOTAL + ', Threads: ' + THREADS);
    console.log('');

    // Step 1: Generate all test data
    console.log('[Step 1] Generating test data...');
    const tests = await generateTestData(TOTAL);
    console.log('  Generated ' + tests.length + ' test cases');
    console.log('');

    // Verify SPJ program works on a sample
    const sampleR = await runProgram(SPJ_BIN, tests[0].spjInput, SPJ_TIMEOUT);
    console.log('[Step 1] SPJ sanity check: code=' + sampleR.code + ' output=' + sampleR.output.toString().trim());
    if (sampleR.code !== 0) {
        console.error('FATAL: SPJ program sanity check failed!');
        process.exit(1);
    }
    console.log('');

    const results = {};

    // Step 2: Engine A - Original serial SPJ
    console.log('[Step 2] Engine A: Original spawn (serial SPJ)...');
    results.original = await engineOriginal(tests);
    console.log('  Result:', JSON.stringify(results.original));
    console.log('');

    // Step 3: Engine B - V3 Worker SPJ
    console.log('[Step 3] Engine B: V3 Worker (4x parallel SPJ)...');
    results.v3 = await engineWorker(createV3WorkerFile(), tests, THREADS);
    console.log('  Result:', JSON.stringify(results.v3));
    console.log('');

    // Step 4: Engine C - V10 Native Worker SPJ
    console.log('[Step 4] Engine C: V10 Native Worker (4x parallel SPJ)...');
    results.v10 = await engineWorker(createV10WorkerFile(), tests, THREADS);
    console.log('  Result:', JSON.stringify(results.v10));
    console.log('');

    // Step 5: Baseline - No SPJ full comparison
    console.log('[Step 5] Baseline: Full comparison without SPJ (V10 worker, ' + THREADS + ' threads)...');
    const v10Baseline = path.join(__dirname, '..', '..', 'src', 'main-process', 'compare-worker-v6.js');
    results.baseline = await runBaselineWorker(v10Baseline, THREADS, TOTAL);
    console.log('  Result:', JSON.stringify(results.baseline));
    console.log('');

    // ── Summary Table ──
    console.log('== Results ==');
    console.log('');
    console.log('| Engine          | AC/' + TOTAL + ' | Wall(ms) | TPS   | WA | TLE/Hung |');
    console.log('|-----------------|------|----------|-------|----|----------|');

    const row = (name, r) => {
        const ac = r.ac !== undefined ? r.ac : r.done;
        const wa = r.wa || 0;
        const tle = (r.tle || 0) + (r.oth || 0);
        console.log(`| ${name.padEnd(15)} | ${String(ac).padStart(4)} | ${String(r.wallMs).padStart(8)} | ${r.tps.toFixed(1).padStart(5)} | ${String(wa).padStart(2)} | ${String(tle).padStart(8)} |`);
    };

    row('Original Spawn', results.original);
    row('V3 Worker x' + THREADS, results.v3);
    row('V10 Native x' + THREADS, results.v10);
    row('Baseline (noSPJ)', results.baseline);
    console.log('');

    // ── SPJ Overhead Analysis ──
    console.log('== SPJ Overhead Analysis ==');
    if (results.baseline.tps > 0 && results.v10.tps > 0) {
        const overhead = (results.baseline.tps - results.v10.tps) / results.baseline.tps * 100;
        console.log(`  Baseline TPS (no SPJ):    ${results.baseline.tps.toFixed(1)}`);
        console.log(`  V10 SPJ TPS:              ${results.v10.tps.toFixed(1)}`);
        console.log(`  SPJ overhead:             ${overhead.toFixed(1)}%`);
        console.log(`  SPJ call overhead/test:   ${((results.baseline.wallMs / TOTAL) - (results.v10.wallMs / TOTAL)).toFixed(1)} ms`);
    }

    if (results.original.tps > 0 && results.v10.tps > 0) {
        const speedup = (results.v10.tps / results.original.tps - 1) * 100;
        console.log(`  V10 vs Original speedup:  ${speedup > 0 ? '+' : ''}${speedup.toFixed(1)}%`);
    }
    console.log('');
    console.log('== Done ==');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
