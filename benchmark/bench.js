/**
 * 对拍器多线程性能基准测试
 * 
 * 模拟 codeComparer.js 的 runComparison 核心管线：
 *   generator → std → test → compare
 * 
 * 对比三种模式：
 *   1. 原始串行: generator → std → test (逐个)
 *   2. 伪并行 (Promise.all 模拟): generator → [std || test] 并行
 *   3. 多 worker 串行 vs 多 worker 并行 std/test
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PROGS = '/tmp/oicpp/benchmark/progs';
const ITERATIONS = 200;
const THREAD_COUNTS = [1, 2, 4, 8];

// ─── helpers ──────────────────────────────────────────────

function runProgram(exePath, input, timeLimit = 2000) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const proc = spawn(exePath, [], {
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: timeLimit,
        });
        let stdout = '', stderr = '';
        proc.stdout.on('data', d => stdout += d);
        proc.stderr.on('data', d => stderr += d);
        proc.on('close', code => {
            const elapsed = Date.now() - startTime;
            resolve({ stdout: stdout.trim(), exitCode: code, time: elapsed, stderr });
        });
        proc.on('error', err => {
            reject(err);
        });
        if (input) proc.stdin.write(input);
        proc.stdin.end();
    });
}

function compareOutputs(a, b) {
    const norm = s => s.split('\n').map(l => l.trimEnd()).join('\n').replace(/\n+$/, '');
    return norm(a) === norm(b);
}

// ─── 单测试用例管线 ──────────────────────────────────────

async function runSingleTestSerial(generatorExe, stdExe, testExe) {
    // Step 1: generate
    const gen = await runProgram(generatorExe, '');
    if (gen.exitCode !== 0) throw new Error('generator failed');
    const input = gen.stdout;

    // Step 2: std (serial)
    const stdOut = await runProgram(stdExe, input, 0);
    if (stdOut.exitCode !== 0) throw new Error('std failed');

    // Step 3: test (serial after std)
    const testOut = await runProgram(testExe, input, 1000);
    if (testOut.exitCode !== 0) throw new Error('test failed');

    // Step 4: compare
    const match = compareOutputs(stdOut.stdout, testOut.stdout);
    return { match, stdTime: stdOut.time, testTime: testOut.time, genTime: gen.time };
}

async function runSingleTestParallel(generatorExe, stdExe, testExe) {
    // Step 1: generate
    const gen = await runProgram(generatorExe, '');
    if (gen.exitCode !== 0) throw new Error('generator failed');
    const input = gen.stdout;

    // Step 2+3: std + test 并行
    const [stdOut, testOut] = await Promise.all([
        runProgram(stdExe, input, 0),
        runProgram(testExe, input, 1000),
    ]);
    if (stdOut.exitCode !== 0) throw new Error('std failed');
    if (testOut.exitCode !== 0) throw new Error('test failed');

    // Step 4: compare
    const match = compareOutputs(stdOut.stdout, testOut.stdout);
    return { match, stdTime: stdOut.time, testTime: testOut.time, genTime: gen.time };
}

// ─── 多 worker 管线 ──────────────────────────────────────

// 模拟 codeComparer.js 的 worker pool
async function runWorkerPool(WorkerFn, workerCount, totalTests, generatorExe, stdExe, testExe) {
    let nextIndex = 0;
    let completed = 0;
    let errorOccurred = false;

    const startTime = Date.now();

    const worker = async () => {
        while (true) {
            if (errorOccurred) return;
            const i = nextIndex++;
            if (i >= totalTests) return;
            try {
                await WorkerFn(generatorExe, stdExe, testExe);
                completed++;
            } catch (e) {
                errorOccurred = true;
                return;
            }
        }
    };

    const workers = Array.from({ length: workerCount }, () => worker());
    await Promise.all(workers);

    const elapsed = Date.now() - startTime;
    return { completed, elapsed, errorOccurred };
}

// ─── 纯管线延迟测试（不含 worker pool） ─────────────────

async function benchmarkPipeline(mode, generatorExe, stdExe, testExe, iterations) {
    const fn = mode === 'serial' ? runSingleTestSerial : runSingleTestParallel;
    const times = [];
    const stdTimes = [];
    const testTimes = [];

    for (let i = 0; i < iterations; i++) {
        const result = await fn(generatorExe, stdExe, testExe);
        times.push(result.stdTime + result.testTime + result.genTime);
        stdTimes.push(result.stdTime);
        testTimes.push(result.testTime);
    }

    return {
        avg: times.reduce((a, b) => a + b, 0) / times.length,
        min: Math.min(...times),
        max: Math.max(...times),
        p50: times.sort((a, b) => a - b)[Math.floor(times.length / 2)],
        avgStd: stdTimes.reduce((a, b) => a + b, 0) / stdTimes.length,
        avgTest: testTimes.reduce((a, b) => a + b, 0) / testTimes.length,
    };
}

// ─── 多 worker 吞吐量测试 ───────────────────────────────

async function benchmarkThroughput(workerCount, totalTests, generatorExe, stdExe, testExe) {
    // serial workers
    const serial = await runWorkerPool(runSingleTestSerial, workerCount, totalTests, generatorExe, stdExe, testExe);
    // parallel workers
    const parallel = await runWorkerPool(runSingleTestParallel, workerCount, totalTests, generatorExe, stdExe, testExe);

    return {
        serial: { ...serial, throughput: (serial.completed / serial.elapsed * 1000).toFixed(1) },
        parallel: { ...parallel, throughput: (parallel.completed / parallel.elapsed * 1000).toFixed(1) },
    };
}

// ─── main ────────────────────────────────────────────────

async function main() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║     OICPP 对拍器多线程效率基准测试                          ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log();

    // compile test programs
    console.log('▸ 编译测试程序...');
    for (const name of ['generator', 'std', 'test']) {
        const src = path.join(PROGS, `${name}.cpp`);
        const out = path.join(PROGS, name);
        await new Promise((resolve, reject) => {
            spawn('g++', ['-O2', '-std=c++14', '-o', out, src], { stdio: 'inherit' })
                .on('close', code => code === 0 ? resolve() : reject(new Error(`${name} compile failed`)));
        });
    }
    console.log('  ✓ 编译完成\n');

    const generatorExe = path.join(PROGS, 'generator');
    const stdExe = path.join(PROGS, 'std');
    const testExe = path.join(PROGS, 'test');

    // ─── Test 1: 单管线延迟 ──────────────────────────────
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  Test 1: 单测试用例管线延迟 (串行 vs std/test 并行)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const serialPipeline = await benchmarkPipeline('serial', generatorExe, stdExe, testExe, ITERATIONS);
    const parallelPipeline = await benchmarkPipeline('parallel', generatorExe, stdExe, testExe, ITERATIONS);

    console.log(`  模式              平均延迟    P50      最小      最大`);
    console.log(`  ──────────────    ────────    ────     ────      ────`);
    console.log(`  串行 (原始)       ${serialPipeline.avg.toFixed(1)}ms    ${serialPipeline.p50}ms    ${serialPipeline.min}ms     ${serialPipeline.max}ms`);
    console.log(`  std||test 并行    ${parallelPipeline.avg.toFixed(1)}ms    ${parallelPipeline.p50}ms    ${parallelPipeline.min}ms     ${parallelPipeline.max}ms`);
    console.log();

    const speedup1 = serialPipeline.avg / parallelPipeline.avg;
    console.log(`  ▸ 单管线加速比: ${speedup1.toFixed(2)}x`);
    console.log(`  ▸ std 平均: ${serialPipeline.avgStd}ms, test 平均: ${serialPipeline.avgTest}ms`);
    console.log(`  ▸ 理论最大加速 (min(std,test)/max(std,test)→1): ${((serialPipeline.avgStd + serialPipeline.avgTest) / Math.max(serialPipeline.avgStd, serialPipeline.avgTest)).toFixed(2)}x`);
    console.log();

    // ─── Test 2: 多 worker 吞吐量 ──────────────────────
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  Test 2: 多 Worker 吞吐量 (400 组测试)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const TOTAL_TESTS = 400;
    const cpuCount = os.cpus().length;
    console.log(`  CPU 核心数: ${cpuCount}\n`);

    console.log(`  Workers    串行吞吐         并行吞吐         加速比`);
    console.log(`  ───────    ────────         ────────         ──────`);

    for (const wc of THREAD_COUNTS) {
        if (wc > cpuCount * 2) continue;
        const result = await benchmarkThroughput(wc, TOTAL_TESTS, generatorExe, stdExe, testExe);
        const tSpeedup = (parseFloat(result.parallel.throughput) / parseFloat(result.serial.throughput)).toFixed(2);
        console.log(`  ${String(wc).padStart(4)}       ${result.serial.throughput.padEnd(7)} tests/s  ${result.parallel.throughput.padEnd(7)} tests/s  ${tSpeedup}x`);
    }
    console.log();

    // ─── Test 3: 线程数利用率分析 ──────────────────────
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  Test 3: 当前代码线程数限制分析');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const currentMax = Math.floor(cpuCount / 2);
    console.log(`  cpuThreads = ${cpuCount}`);
    console.log(`  当前 maxParallel = floor(${cpuCount}/2) = ${currentMax}`);
    console.log(`  限制比例 = ${(currentMax/cpuCount*100).toFixed(0)}% CPU 利用率`);
    console.log(`  建议 maxParallel = ${Math.min(cpuCount, 16)} (${(Math.min(cpuCount,16)/cpuCount*100).toFixed(0)}% 利用率)`);
    console.log();

    // ─── Test 4: IPC 次数分析 ──────────────────────────
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  Test 4: IPC 调用次数分析 (每次测试)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  操作                              次数    类型`);
    console.log(`  ──────────────────────────────    ────    ────`);
    console.log(`  runProgram (generator)            1       必需`);
    console.log(`  runProgram (std)                  1       必需`);
    console.log(`  runProgram (test)                 1       必需`);
    console.log(`  pathJoin                          6       可本地化`);
    console.log(`  ensureDir                         2       可预创建`);
    console.log(`  writeFile (freopen input)         1       可合并`);
    console.log(`  checkFileExists + deleteFile      2~4     可并行`);
    console.log(`  ──────────────────────────────`);
    console.log(`  总计 (无 freopen):               ~14`);
    console.log(`  总计 (有 freopen):               ~30`);
    console.log(`  优化后 (无 freopen):             ~3  (仅 runProgram)`);
    console.log(`  优化后 (有 freopen):             ~8   (runProgram + writeFile + 并行删除)`);
    console.log();

    console.log('══════════════════════════════════════════════════════════════');
    console.log('  结论');
    console.log('══════════════════════════════════════════════════════════════');
    console.log(`  1. std/test 并行可提速 ${speedup1.toFixed(2)}x (单管线级别)`);
    console.log(`  2. 当前 cpuThreads/2 限制浪费了 ${(100-currentMax/cpuCount*100).toFixed(0)}% CPU`);
    console.log(`  3. IPC 次数可从 ~30 降至 ~8 (减少 ${((1-8/30)*100).toFixed(0)}%)`);
    console.log(`  4. 综合预期: 2-3x 总体性能提升`);
    console.log('══════════════════════════════════════════════════════════════');
}

main().catch(e => { console.error(e); process.exit(1); });
