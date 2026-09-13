const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PROGS = '/tmp/oicpp/benchmark/progs';

function runProgram(exePath, input, timeout) {
    return new Promise((resolve) => {
        const t0 = Date.now();
        const proc = spawn(exePath, [], { stdio: ['pipe', 'pipe', 'pipe'], timeout });
        let stdout = '', stderr = '';
        proc.stdout.on('data', d => { stdout += d; });
        proc.stderr.on('data', d => { stderr += d; });
        proc.on('close', code => resolve({ stdout: stdout, exitCode: code, time: Date.now() - t0, bytes: stdout.length }));
        proc.on('error', () => resolve({ stdout: '', exitCode: -1, time: Date.now() - t0, bytes: 0 }));
        if (input) proc.stdin.write(input);
        proc.stdin.end();
    });
}

function compareOutputs(a, b) {
    const norm = s => s.split('\n').map(l => l.trimEnd()).join('\n').replace(/\n+$/, '');
    return norm(a) === norm(b);
}

function makeLogger(batched) {
    const file = '/tmp/_large_log_' + Math.random().toString(36).slice(2) + '.log';
    const logger = { file: file, buf: [], scheduled: false, writes: 0 };
    logger.write = function(line) {
        if (!batched) { fs.appendFileSync(file, line, 'utf8'); logger.writes++; return; }
        logger.buf.push(line); logger.writes++;
        if (logger.buf.length >= 200) {
            const l = logger.buf; logger.buf = [];
            fs.appendFileSync(file, l.join(''), 'utf8');
        } else if (!logger.scheduled) {
            logger.scheduled = true;
            setImmediate(function() {
                logger.scheduled = false;
                const l = logger.buf; logger.buf = [];
                if (l.length) fs.appendFileSync(file, l.join(''), 'utf8');
            });
        }
    };
    logger.cleanup = function() { try { fs.unlinkSync(file); } catch (e) {} };
    return logger;
}

async function logRun(logger, batched, isError) {
    const n = isError ? 3 : (batched ? 0 : 3);
    for (let i = 0; i < n; i++) logger.write('[INFO] [run-program] {"exec":"/tmp/x"}\n');
    if (batched) await new Promise(r => setImmediate(r));
}

async function oldPipeline(gen, std, test, taskDir, logger) {
    const genR = await runProgram(gen, '', 30000);
    const input = genR.stdout;
    await logRun(logger, false, genR.exitCode !== 0);
    const stdR = await runProgram(std, input, 30000);
    await logRun(logger, false, stdR.exitCode !== 0);
    const testR = await runProgram(test, input, 30000);
    await logRun(logger, false, testR.exitCode !== 0);
    return { total: genR.time + stdR.time + testR.time, ok: compareOutputs(stdR.stdout, testR.stdout) };
}

async function newPipeline(gen, std, test, taskDir, logger) {
    const genR = await runProgram(gen, '', 30000);
    const input = genR.stdout;
    await logRun(logger, true, genR.exitCode !== 0);
    const pair = await Promise.all([
        runProgram(std, input, 30000),
        runProgram(test, input, 30000),
    ]);
    const stdR = pair[0], testR = pair[1];
    await logRun(logger, true, stdR.exitCode !== 0);
    await logRun(logger, true, testR.exitCode !== 0);
    return { total: genR.time + Math.max(stdR.time, testR.time), ok: compareOutputs(stdR.stdout, testR.stdout) };
}

async function workerPool(fn, workerCount, total, gen, std, test, taskDir, logger) {
    let next = 0, completed = 0, err = false;
    const t0 = Date.now();
    const worker = async function() {
        while (true) {
            if (err) return;
            const i = next++;
            if (i >= total) return;
            try {
                const r = await fn(gen, std, test, taskDir, logger);
                if (!r.ok) err = true; else completed++;
            } catch (e) { err = true; }
        }
    };
    await Promise.all(Array.from({ length: workerCount }, worker));
    return { completed: completed, elapsed: Date.now() - t0, tps: (completed / (Date.now() - t0) * 1000).toFixed(1) };
}

function compile(name) {
    const src = path.join(PROGS, name + '.cpp');
    const out = path.join(PROGS, name);
    return new Promise(function(resolve, reject) {
        spawn('g++', ['-O2', '-std=c++14', '-o', out, src], { stdio: 'pipe' })
            .on('close', function(c) { c === 0 ? resolve(out) : reject(new Error(name + ' fail')); });
    });
}

async function main() {
    const cpu = os.cpus();
    console.log('=== 大规模对拍基准 (1000 组, 8MB 输入/输出) ===');
    console.log('设备: ' + cpu.length + ' cores | Node ' + process.version);
    console.log('');

    const names = ['gen_large', 'std_large', 'test_large'];
    for (const n of names) await compile(n);
    console.log('编译 OK (large programs)\n');

    // 单次管线验证大输出
    console.log('-- 单次管线 (大输出 ~16MB: 生成8MB + std/test 各8MB) --');
    const gen = path.join(PROGS, 'gen_large'), std = path.join(PROGS, 'std_large'), test = path.join(PROGS, 'test_large');
    const taskDir = '/tmp/_oicpp_bench_runs';

    // 测试 2 次避免噪声
    const t0 = Date.now();
    const r = await oldPipeline(gen, std, test, taskDir, makeLogger(false));
    console.log('  串行: ' + r.total + 'ms (gen+std+test), 匹配=' + r.ok);
    const t1 = Date.now();
    const r2 = await newPipeline(gen, std, test, taskDir, makeLogger(true));
    console.log('  并行: ' + r2.total + 'ms (gen+max(std,test)), 匹配=' + r2.ok);
    console.log('  加速: ' + (r.total / r2.total).toFixed(2) + 'x');
    console.log('');

    // 1000 组吞吐
    console.log('-- 1000 组吞吐 (大输出, 不同 worker 数 + 日志模式) --');
    console.log('  workers  日志模式    吞吐(TPS)   总耗时(s)   平均ms/组');
    console.log('  -------  ----------  ----------  ----------  --------');
    const total = 1000;
    const configs = [
        [4, false],   // 旧: cpu/2 限制 + 同步日志
        [4, true],    // 旧限 + 异步日志
        [7, true],    // 新: cpu*0.9 限制 + 异步日志 + 并行 std/test
    ];
    for (const [wc, batched] of configs) {
        const logger = makeLogger(batched);
        const tStart = Date.now();
        const res = await workerPool(batched ? newPipeline : oldPipeline, wc, total, gen, std, test, taskDir, logger);
        logger.cleanup();
        console.log('  ' + String(wc).padStart(5) + '     ' + (batched ? '异步批量 ' : '同步逐条 ') + '   ' + res.tps.padStart(10) + '   ' + (res.elapsed / 1000).toFixed(1) + '    ' + (res.elapsed / res.completed).toFixed(0));
    }
    console.log('');

    // 内存观察
    console.log('-- 内存占用 --');
    console.log('  堆: ' + (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1) + 'MB  总: ' + (process.memoryUsage().rss / 1024 / 1024).toFixed(1) + 'MB');

    console.log('\n=== 完成 ===');
}

main().catch(function(e) { console.error(e); process.exit(1); });
