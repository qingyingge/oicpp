/**
 * test-interactive.js — 验证交互/通信式程序在三引擎上的死锁问题
 * 引擎A: 原版 runProgram (child_process)
 * 引擎B: V3 worker (compare-worker.js)
 * 引擎C: V10 worker (compare-worker-v6.js)
 */
const path = require('path');
const { spawn } = require('child_process');
const { Worker } = require('worker_threads');

const PROGS = path.join(__dirname, 'progs2');
const WORKER_DIR = path.join(__dirname, '..', 'src', 'main-process');
const COUNT = 20;
const TIMEOUT = 5000;

// --- 引擎A: 原版 runProgram ---
function runProgram(exePath, input, timeLimit) {
    return new Promise((resolve) => {
        const t0 = Date.now();
        let child;
        try {
            child = spawn(exePath, [], { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
        } catch (e) {
            return resolve({ code: -1, error: e.message, ms: 0, timeout: false });
        }
        const stdoutChunks = [];
        const stderrChunks = [];
        let killed = false, settled = false;
        const timer = setTimeout(() => {
            killed = true;
            try { child.kill('SIGKILL'); } catch (_) {}
        }, timeLimit || 60000);
        child.stdout.on('data', (c) => { if (!killed) stdoutChunks.push(c); });
        child.stderr.on('data', (c) => { if (!killed) stderrChunks.push(c); });
        child.on('error', (e) => {
            if (!settled) { settled = true; clearTimeout(timer);
                resolve({ code: -1, error: e.message, ms: Date.now() - t0, timeout: killed, output: Buffer.concat(stdoutChunks) }); }
        });
        child.on('close', (code) => {
            if (!settled) { settled = true; clearTimeout(timer);
                resolve({ code, ms: Date.now() - t0, timeout: killed, output: Buffer.concat(stdoutChunks), error: killed ? 'TLE' : null }); }
        });
        if (input && input.length > 0) child.stdin.write(input);
        child.stdin.end();
    });
}

async function runOriginal(genPath, procPath, count, timeout) {
    const results = { ok: 0, tle: 0, re: 0, errors: [], totalTime: 0 };
    const t0 = Date.now();
    for (let i = 0; i < count; i++) {
        const genR = await runProgram(genPath, '', 5000);
        if (genR.timeout || genR.error || genR.code !== 0) {
            results.errors.push({ i, kind: 'gen_fail' });
            continue;
        }
        const procR = await runProgram(procPath, genR.output, timeout);
        if (procR.timeout) { results.tle++; results.errors.push({ i, kind: 'tle', ms: procR.ms }); }
        else if (procR.code !== 0) { results.re++; results.errors.push({ i, kind: 're', code: procR.code, ms: procR.ms }); }
        else { results.ok++; }
    }
    results.totalTime = Date.now() - t0;
    return results;
}

// --- 引擎B/C: worker ---
function runWorker(workerFile, genPath, procPath, count, timeout) {
    return new Promise((resolve) => {
        const t0 = Date.now();
        const worker = new Worker(path.join(WORKER_DIR, workerFile), {
            workerData: {}
        });
        const results = { ok: 0, tle: 0, re: 0, errors: [], totalTime: 0, done: false };

        const timer = setTimeout(() => {
            if (!results.done) {
                results.errors.push({ kind: 'worker_hung', msg: 'worker no response' });
                worker.terminate();
                results.totalTime = Date.now() - t0;
                resolve(results);
            }
        }, (timeout + 2000) * count / 10 + 10000); // generous timeout

        worker.on('message', (msg) => {
            if (msg.type === 'progress') { results.ok++; }
            else if (msg.type === 'error') {
                if (msg.kind === 'std_tle' || msg.kind === 'test_tle') { results.tle++; results.errors.push(msg); }
                else { results.re++; results.errors.push(msg); }
            } else if (msg.type === 'done') {
                results.done = true;
                clearTimeout(timer);
                results.totalTime = Date.now() - t0;
                worker.terminate();
                resolve(results);
            }
        });
        worker.on('error', (e) => {
            if (!results.done) {
                results.done = true;
                clearTimeout(timer);
                results.errors.push({ kind: 'worker_error', msg: e.message });
                results.totalTime = Date.now() - t0;
                resolve(results);
            }
        });

        worker.postMessage({
            type: 'run-tests',
            startIdx: 0,
            count,
            genPath,
            stdPath: procPath,
            testPath: procPath,
            timeout
        });
    });
}

async function main() {
    const pairs = [
        { label: 'inter', gen: path.join(PROGS, 'gen_inter'), proc: path.join(PROGS, 'inter_proc') },
        { label: 'comm',  gen: path.join(PROGS, 'gen_comm'),  proc: path.join(PROGS, 'comm_proc') },
    ];

    console.log('== 交互/通信程序死锁测试 ==\n');

    // 引擎A
    console.log('[Engine A] 原版 child_process runProgram');
    for (const p of pairs) {
        const r = await runOriginal(p.gen, p.proc, COUNT, TIMEOUT);
        console.log(`  ${p.label}: OK=${r.ok} TLE=${r.tle} RE=${r.re} time=${r.totalTime}ms` +
            (r.errors.length ? ' errors=' + JSON.stringify(r.errors.slice(0, 3)) : ''));
    }

    // 引擎B
    console.log('[Engine B] V3 compare-worker.js');
    for (const p of pairs) {
        const r = await runWorker('compare-worker.js', p.gen, p.proc, COUNT, TIMEOUT);
        console.log(`  ${p.label}: OK=${r.ok} TLE=${r.tle} RE=${r.re} time=${r.totalTime}ms` +
            (r.errors.length ? ' errors=' + JSON.stringify(r.errors.slice(0, 3)) : ''));
    }

    // 引擎C
    console.log('[Engine C] V10 compare-worker-v6.js');
    for (const p of pairs) {
        const r = await runWorker('compare-worker-v6.js', p.gen, p.proc, COUNT, TIMEOUT);
        console.log(`  ${p.label}: OK=${r.ok} TLE=${r.tle} RE=${r.re} time=${r.totalTime}ms` +
            (r.errors.length ? ' errors=' + JSON.stringify(r.errors.slice(0, 3)) : ''));
    }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
