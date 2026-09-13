const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PROGS = '/tmp/oicpp/benchmark/progs';

function runProgram(exePath, input, timeout) {
    return new Promise((resolve) => {
        const t0 = Date.now();
        const proc = spawn(exePath, [], { stdio: ['pipe', 'pipe', 'pipe'], timeout });
        let stdout = '';
        proc.stdout.on('data', d => { stdout += d; });
        proc.stderr.on('data', () => {});
        proc.on('close', code => resolve({ stdout: stdout, exitCode: code, time: Date.now() - t0 }));
        proc.on('error', () => resolve({ stdout: '', exitCode: -1, time: Date.now() - t0 }));
        if (input) proc.stdin.write(input);
        proc.stdin.end();
    });
}

function compareOutputs(a, b) {
    const norm = s => s.split('\n').map(l => l.trimEnd()).join('\n').replace(/\n+$/, '');
    return norm(a) === norm(b);
}

function makeLogger(batched) {
    const file = '/tmp/_large2_log_' + Math.random().toString(36).slice(2) + '.log';
    const logger = { file: file, buf: [], scheduled: false };
    logger.write = function(line) {
        if (!batched) { fs.appendFileSync(file, line, 'utf8'); return; }
        logger.buf.push(line);
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

async function oldPipeline(gen, std, test, logger) {
    const genR = await runProgram(gen, '', 60000);
    const input = genR.stdout;
    await logRun(logger, false, genR.exitCode !== 0);
    const stdR = await runProgram(std, input, 60000);
    await logRun(logger, false, stdR.exitCode !== 0);
    const testR = await runProgram(test, input, 60000);
    await logRun(logger, false, testR.exitCode !== 0);
    return { total: genR.time + stdR.time + testR.time, ok: compareOutputs(stdR.stdout, testR.stdout) };
}

async function newPipeline(gen, std, test, logger) {
    const genR = await runProgram(gen, '', 60000);
    const input = genR.stdout;
    await logRun(logger, true, genR.exitCode !== 0);
    const pair = await Promise.all([
        runProgram(std, input, 60000),
        runProgram(test, input, 60000),
    ]);
    const stdR = pair[0], testR = pair[1];
    await logRun(logger, true, stdR.exitCode !== 0);
    await logRun(logger, true, testR.exitCode !== 0);
    return { total: genR.time + Math.max(stdR.time, testR.time), ok: compareOutputs(stdR.stdout, testR.stdout) };
}

async function workerPool(fn, workerCount, total, gen, std, test, logger) {
    let next = 0, completed = 0, err = false;
    const t0 = Date.now();
    const worker = async function() {
        while (true) {
            if (err) return;
            const i = next++;
            if (i >= total) return;
            try {
                const r = await fn(gen, std, test, logger);
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
    console.log('=== Large compare benchmark (300 groups, 8MB output each) ===');
    console.log('Device: ' + cpu.length + ' cores | Node ' + process.version);
    for (const n of ['gen_large', 'std_large', 'test_large']) await compile(n);
    console.log('Compile OK (large programs)\n');

    const gen = path.join(PROGS, 'gen_large'), std = path.join(PROGS, 'std_large'), test = path.join(PROGS, 'test_large');

    console.log('-- Single pipeline (large output) --');
    const r = await oldPipeline(gen, std, test, makeLogger(false));
    const r2 = await newPipeline(gen, std, test, makeLogger(true));
    console.log('  serial: ' + r.total + 'ms  parallel: ' + r2.total + 'ms  speedup: ' + (r.total / r2.total).toFixed(2) + 'x\n');

    console.log('-- 300 groups throughput (large output) --');
    console.log('  workers  log mode      TPS      total(s)   ms/group');
    console.log('  -------  ------------  ------   --------   --------');
    const total = 300;
    const configs = [
        [4, false, 'old'],
        [4, true, 'new'],
        [7, true, 'new'],
    ];
    for (const [wc, batched, mode] of configs) {
        const logger = makeLogger(batched);
        const res = await workerPool(mode === 'new' ? newPipeline : oldPipeline, wc, total, gen, std, test, logger);
        logger.cleanup();
        console.log('  ' + String(wc).padStart(5) + '     ' + (batched ? 'async-batch ' : 'sync-line   ') + '  ' + res.tps.padStart(5) + '    ' + (res.elapsed / 1000).toFixed(1) + '       ' + (res.elapsed / res.completed).toFixed(0));
    }

    console.log('\n  RSS: ' + (process.memoryUsage().rss / 1024 / 1024).toFixed(0) + 'MB');
    console.log('=== Done ===');
}

main().catch(function(e) { console.error(e); process.exit(1); });
