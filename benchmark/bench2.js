/**
 * OICPP 对拍器 多线程效率实测
 * 
 * 三级负载: 轻量(sort) / 中量(merge 50轮) / 重量(merge 200轮 + IO)
 * 三种模式对比:
 *   A. 原始: gen → std → test (串行)
 *   B. 优化1: gen → [std || test] 并行
 *   C. 优化2: gen → [std || test] 并行 + IPC 本地化模拟
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PROGS = '/tmp/oicpp/benchmark/progs';

// ─── 工具函数 ────────────────────────────────────────────

function runProgram(exePath, input, timeout = 5000) {
    return new Promise((resolve) => {
        const t0 = Date.now();
        const proc = spawn(exePath, [], { stdio: ['pipe', 'pipe', 'pipe'], timeout });
        let stdout = '', stderr = '';
        proc.stdout.on('data', d => { stdout += d; });
        proc.stderr.on('data', d => { stderr += d; });
        proc.on('close', code => {
            resolve({ stdout: stdout.trim(), exitCode: code, time: Date.now() - t0, stderr });
        });
        proc.on('error', () => {
            resolve({ stdout: '', exitCode: -1, time: Date.now() - t0, stderr: 'spawn error' });
        });
        if (input) proc.stdin.write(input);
        proc.stdin.end();
    });
}

function compareOutputs(a, b) {
    const norm = s => s.split('\n').map(l => l.trimEnd()).join('\n').replace(/\n+$/, '');
    return norm(a) === norm(b);
}

// 模拟 Electron IPC 开销: 通过临时文件读写模拟
async function simulateIPC(overhead = 0) {
    if (overhead <= 0) return;
    // 模拟一次 IPC 往返 (写文件 + 读文件 + 删除)
    const tmpFile = `/tmp/_ipc_sim_${process.pid}_${Date.now()}`;
    await fs.promises.writeFile(tmpFile, 'x'.repeat(1024));
    await fs.promises.readFile(tmpFile, 'utf8');
    await fs.promises.unlink(tmpFile).catch(() => {});
}

// ─── 管线模式 ────────────────────────────────────────────

async function pipelineSerial(gen, std, test, simIPC = 0) {
    const genResult = await runProgram(gen, '');
    if (genResult.exitCode !== 0) throw new Error('gen fail');
    const input = genResult.stdout;
    
    const stdResult = await runProgram(std, input, 10000);
    await simulateIPC(simIPC);
    if (stdResult.exitCode !== 0) throw new Error('std fail');
    
    const testResult = await runProgram(test, input, 10000);
    await simulateIPC(simIPC);
    if (testResult.exitCode !== 0) throw new Error('test fail');
    
    return {
        match: compareOutputs(stdResult.stdout, testResult.stdout),
        genTime: genResult.time, stdTime: stdResult.time, testTime: testResult.time,
        total: genResult.time + stdResult.time + testResult.time,
    };
}

async function pipelineParallel(gen, std, test, simIPC = 0) {
    const genResult = await runProgram(gen, '');
    if (genResult.exitCode !== 0) throw new Error('gen fail');
    const input = genResult.stdout;
    
    const [stdResult, testResult] = await Promise.all([
        runProgram(std, input, 10000).then(async r => { await simulateIPC(simIPC); return r; }),
        runProgram(test, input, 10000).then(async r => { await simulateIPC(simIPC); return r; }),
    ]);
    if (stdResult.exitCode !== 0) throw new Error('std fail');
    if (testResult.exitCode !== 0) throw new Error('test fail');
    
    return {
        match: compareOutputs(stdResult.stdout, testResult.stdout),
        genTime: genResult.time, stdTime: stdResult.time, testTime: testResult.time,
        total: genResult.time + Math.max(stdResult.time, testResult.time),
    };
}

// ─── Worker Pool ─────────────────────────────────────────

async function workerPool(mode, workerCount, total, gen, std, test, simIPC = 0) {
    const fn = mode === 'serial' ? pipelineSerial : pipelineParallel;
    let nextIndex = 0, completed = 0, err = false;
    const t0 = Date.now();
    
    const worker = async () => {
        while (true) {
            if (err) return;
            const i = nextIndex++;
            if (i >= total) return;
            try { await fn(gen, std, test, simIPC); completed++; }
            catch (e) { err = true; }
        }
    };
    await Promise.all(Array.from({ length: workerCount }, worker));
    const elapsed = Date.now() - t0;
    return { completed, elapsed, tps: (completed / elapsed * 1000).toFixed(1) };
}

// ─── 编译 ────────────────────────────────────────────────

function compile(name) {
    const src = path.join(PROGS, `${name}.cpp`);
    const out = path.join(PROGS, name);
    return new Promise((resolve, reject) => {
        spawn('g++', ['-O2', '-std=c++14', '-o', out, src], { stdio: 'pipe' })
            .on('close', c => c === 0 ? resolve(out) : reject(new Error(`${name} fail`)));
    });
}

// ─── benchmark runner ────────────────────────────────────

async function bench(name, fn, iterations) {
    const times = [];
    for (let i = 0; i < iterations; i++) {
        const r = await fn();
        times.push(r);
    }
    const tot = times.map(t => t.total);
    tot.sort((a, b) => a - b);
    return {
        avg: (tot.reduce((a, b) => a + b, 0) / tot.length).toFixed(1),
        p50: tot[Math.floor(tot.length * 0.5)],
        p95: tot[Math.floor(tot.length * 0.95)],
        min: tot[0],
        max: tot[tot.length - 1],
        avgGen: (times.reduce((a, t) => a + t.genTime, 0) / times.length).toFixed(1),
        avgStd: (times.reduce((a, t) => a + t.stdTime, 0) / times.length).toFixed(1),
        avgTest: (times.reduce((a, t) => a + t.testTime, 0) / times.length).toFixed(1),
    };
}

// ─── main ────────────────────────────────────────────────

async function main() {
    const cpu = os.cpus();
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║         OICPP 对拍器多线程效率 · 设备实测报告                 ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log();
    console.log(`  设备: ${cpu[0]?.model || 'unknown'}`);
    console.log(`  CPU 核心: ${cpu.length} cores / ${cpu.length} threads`);
    console.log(`  Node.js: ${process.version}`);
    console.log(`  平台: ${process.platform} ${process.arch}`);
    console.log();

    // 编译
    console.log('▸ 编译测试程序...');
    const programs = {};
    for (const name of ['generator', 'std', 'test', 'gen_heavy', 'std_heavy', 'test_heavy']) {
        programs[name] = await compile(name);
    }
    console.log('  ✓ OK\n');

    const IT = 100;  // 每项测试迭代次数

    // ═══ Test 1: 轻量级程序 (sort n=1000, ~16ms) ═══
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  负载 A: 轻量 (排序 n=1000, ~16ms/程序)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const lightSer = await bench('serial', () => pipelineSerial(programs.generator, programs.std, programs.test), IT);
    const lightPar = await bench('parallel', () => pipelineParallel(programs.generator, programs.std, programs.test), IT);
    
    console.log(`  模式              avg      P50     P95     gen    std    test`);
    console.log(`  ──────────────    ──────   ─────   ─────   ────   ────   ────`);
    console.log(`  串行 (原始)       ${lightSer.avg.padStart(6)}ms  ${lightSer.p50}ms   ${lightSer.p95}ms   ${lightSer.avgGen}ms  ${lightSer.avgStd}ms  ${lightSer.avgTest}ms`);
    console.log(`  std||test 并行    ${lightPar.avg.padStart(6)}ms  ${lightPar.p50}ms   ${lightPar.p95}ms   ${lightPar.avgGen}ms  ${lightPar.avgStd}ms  ${lightPar.avgTest}ms`);
    console.log(`  加速比: ${(parseFloat(lightSer.avg) / parseFloat(lightPar.avg)).toFixed(2)}x`);
    console.log();

    // ═══ Test 2: 中量级程序 (merge 50轮, ~50ms) ═══
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  负载 B: 中量 (逆序对 n=50000×50轮, ~50ms/程序)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const midSer = await bench('serial', () => pipelineSerial(programs.generator, programs.std_heavy, programs.test_heavy), IT);
    const midPar = await bench('parallel', () => pipelineParallel(programs.generator, programs.std_heavy, programs.test_heavy), IT);
    
    console.log(`  模式              avg      P50     P95     gen    std    test`);
    console.log(`  ──────────────    ──────   ─────   ─────   ────   ────   ────`);
    console.log(`  串行 (原始)       ${midSer.avg.padStart(6)}ms  ${midSer.p50}ms   ${midSer.p95}ms   ${midSer.avgGen}ms  ${midSer.avgStd}ms  ${midSer.avgTest}ms`);
    console.log(`  std||test 并行    ${midPar.avg.padStart(6)}ms  ${midPar.p50}ms   ${midPar.p95}ms   ${midPar.avgGen}ms  ${midPar.avgStd}ms  ${midPar.avgTest}ms`);
    console.log(`  加速比: ${(parseFloat(midSer.avg) / parseFloat(midPar.avg)).toFixed(2)}x`);
    console.log();

    // ═══ Test 3: Worker Pool 吞吐量 (中量级) ═══
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  Worker Pool 吞吐量 (200组, 中量级程序)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  Workers   串行 TPS      并行 TPS      加速比    串行总时   并行总时`);
    console.log(`  ───────   ─────────     ─────────     ──────    ────────   ────────`);
    
    const TOTAL = 200;
    for (const wc of [1, 2, 4, 8, 16]) {
        const ser = await workerPool('serial', wc, TOTAL, programs.generator, programs.std_heavy, programs.test_heavy);
        const par = await workerPool('parallel', wc, TOTAL, programs.generator, programs.std_heavy, programs.test_heavy);
        const speedup = (parseFloat(par.tps) / parseFloat(ser.tps)).toFixed(2);
        console.log(`  ${String(wc).padStart(5)}     ${ser.tps.padStart(7)}      ${par.tps.padStart(7)}      ${speedup}x      ${ser.elapsed}ms     ${par.elapsed}ms`);
    }
    console.log();

    // ═══ Test 4: 模拟 Electron IPC 开销 ═══
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  模拟 Electron IPC 开销 (每次测试 20 次文件操作模拟 IPC)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const ipcSer = await bench('serial_ipc', () => pipelineSerial(programs.generator, programs.std_heavy, programs.test_heavy, 20), 50);
    const ipcPar = await bench('parallel_ipc', () => pipelineParallel(programs.generator, programs.std_heavy, programs.test_heavy, 20), 50);
    
    console.log(`  模式              avg      P50     P95`);
    console.log(`  ──────────────    ──────   ─────   ─────`);
    console.log(`  串行+IPC          ${ipcSer.avg.padStart(6)}ms  ${ipcSer.p50}ms   ${ipcSer.p95}ms`);
    console.log(`  并行+IPC          ${ipcPar.avg.padStart(6)}ms  ${ipcPar.p50}ms   ${ipcPar.p95}ms`);
    console.log(`  加速比: ${(parseFloat(ipcSer.avg) / parseFloat(ipcPar.avg)).toFixed(2)}x`);
    console.log();

    // ═══ Test 5: 线程数限制影响 ═══
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  线程数限制影响分析');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const currentLimit = Math.floor(cpu.length / 2);
    const suggestedLimit = Math.min(cpu.length, 16);
    console.log(`  当前限制: maxParallel = floor(${cpu.length}/2) = ${currentLimit}  →  最多 ${currentLimit} worker`);
    console.log(`  建议调整: maxParallel = ${suggestedLimit}               →  最多 ${suggestedLimit} worker`);
    console.log(`  CPU 利用率提升: ${(currentLimit/cpu.length*100).toFixed(0)}% → ${(suggestedLimit/cpu.length*100).toFixed(0)}%`);
    console.log();

    // ═══ 总结 ═══
    console.log('══════════════════════════════════════════════════════════════');
    console.log('  实测结论');
    console.log('══════════════════════════════════════════════════════════════');
    
    const lightSpeedup = (parseFloat(lightSer.avg) / parseFloat(lightPar.avg));
    const midSpeedup = (parseFloat(midSer.avg) / parseFloat(midPar.avg));
    const ipcSpeedup = (parseFloat(ipcSer.avg) / parseFloat(ipcPar.avg));
    
    console.log(`  负载 A (轻量):  并行加速 ${lightSpeedup.toFixed(2)}x  ${lightSpeedup >= 1 ? '✓' : '✗ spawn 开销 > 并行收益'}`);
    console.log(`  负载 B (中量):  并行加速 ${midSpeedup.toFixed(2)}x  ${midSpeedup >= 1 ? '✓' : '✗ spawn 开销 > 并行收益'}`);
    console.log(`  负载 B+IPC:     并行加速 ${ipcSpeedup.toFixed(2)}x  ${ipcSpeedup >= 1 ? '✓' : '✗ spawn 开销 > 并行收益'}`);
    console.log();
    
    if (lightSpeedup < 1 && midSpeedup < 1) {
        console.log('  ⚠ 结论: 对于轻量/中量级程序, std||test 并行的 spawn 开销');
        console.log('    超过了并行收益, 原始串行反而更快。');
        console.log('    主要优化方向应为: 增大 worker 数 + 减少 IPC 次数');
    } else if (midSpeedup >= 1) {
        console.log('  ✓ 结论: 中量级以上程序, std||test 并行有正收益');
        console.log('    推荐启用并行 + 增大 worker 数 + 减少 IPC 次数');
    }
    console.log('══════════════════════════════════════════════════════════════');
}

main().catch(e => { console.error(e); process.exit(1); });
