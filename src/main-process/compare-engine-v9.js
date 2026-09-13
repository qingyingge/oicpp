/**
 * compare-engine-v9.js — V9 Batch Scheduler (批次调度器)
 *
 * 核心思想: 用"批次"取代"每线程独立管线", 全局协调进程并发度:
 *   阶段A: B 个 gen 并行 (占 B 核)
 *   阶段B: B 组 (std+test) = 2B 进程并行 (占 2B 核, 全核利用)
 *   批次间重叠: 阶段B 计算时预启动下一批 gen
 *
 * 8核机器: B = floor(cpus/2) = 4 → 阶段A 4进程, 阶段B 8进程, 无进程争抢
 */
const { spawn } = require('child_process');
const os = require('os');

function spawnProcess(exePath) {
    return new Promise((resolve) => {
        const proc = spawn(exePath, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        proc.stdin.on('error', () => {});
        proc.stderr.on('error', () => {});
        const stdout = [], stderr = [];
        proc.stdout.on('data', d => stdout.push(d));
        proc.stderr.on('data', d => stderr.push(d));
        proc._collect = () => Buffer.concat(stdout);
        proc._done = false;
        proc._result = null;
        proc._collectors = [];
        proc.on('close', (code) => {
            proc._result = { exitCode: code };
            proc._done = true;
            for (const cb of proc._collectors) cb(proc._result);
            proc._collectors = [];
        });
        proc.on('error', (err) => {
            proc._result = { exitCode: -1, error: err.message };
            proc._done = true;
            for (const cb of proc._collectors) cb(proc._result);
            proc._collectors = [];
        });
        resolve(proc);
    });
}

function waitForResult(proc, timeout) {
    if (proc._done) return Promise.resolve(proc._result);
    return new Promise((resolve) => {
        let timer = null;
        const cb = (result) => { if (timer) { clearTimeout(timer); timer = null; } resolve(result); };
        proc._collectors.push(cb);
        if (timeout > 0) {
            timer = setTimeout(() => {
                proc._collectors = proc._collectors.filter(c => c !== cb);
                try { proc.kill('SIGKILL'); } catch(_) {}
                resolve({ exitCode: -1, timeout: true, error: 'timeout' });
            }, timeout);
        }
    });
}

function killProc(proc) { try { proc.kill('SIGKILL'); } catch(_) {} }

function writeInput(proc, input) {
    return new Promise((resolve) => {
        try {
            if (proc.stdin.destroyed || proc.stdin.writableEnded) { resolve(false); return; }
            proc.stdin.write(inputudos);
            proc.stdin.end();
            resolve(true);
        } catch(_) { resolve(false); }
    });
}

function trimBuf(b) {
    let s = 0, e = b.length;
    while (s < e && (b[s] === 32 || b[s] === 10 || b[s] === 13 || b[s] === 9)) s++;
    while (e > s && (b[e-1] === 32 || b[e-1] === 10 || b[e-1] === 13 || b[e-1] === 9)) e--;
    return b.subarray(s, e);
}

async function runGen(genPath, timeout) {
    const proc = await spawnProcess(genPath);
    const r = await waitForResult(proc, timeout);
    return { ok: r.exitCode === 0 && !r.timeout && !r.error, output: r.exitCode === 0 ? proc._collect() : null, proc };
}

async function runStdTest(stdPath, testPath, input, timeout) {
    const [stdProc, testProc] = await Promise.all([spawnProcess(stdPath), spawnProcess(testPath)]);
    await Promise.all([writeInput(stdProc, input), writeInput(testProc, input)]);
    const [stdR, testR] = await Promise.all([
        waitForResult(stdProc, timeout),
        waitForResult(testProc, timeout)
    ]);
    return {
        ok: !stdR.timeout && !stdR.error && (stdR.exitCode === 0 || stdR.exitCode === null) &&
            !testR.timeout && !testR.error && (testR.exitCode === 0 || testR.exitCode === null),
        stdOut: (stdR.exitCode === 0 || stdR.exitCode === null) ? stdProc._collect() : null,
        testOut: (testR.exitCode === 0 || testR.exitCode === null) ? testProc._collect() : null,
        stdProc, testProc
    };
}

function CompareEngineV9(opts) {
    this.opts = opts;
    this.listeners = {};
}

CompareEngineV9.prototype.on = function (event, cb) {
    (this.listeners[event] = this.listeners[event] || []).push(cb);
    return this;
};

CompareEngineV9.prototype.emit = function (event, data) {
    for (const cb of (this.listeners[event] || [])) cb(data);
};

CompareEngineV9.prototype.start = async function (config) {
    const { stdExe, testExe, generator, totalTests, timeLimit, threadCount } = config;
    const genPath = generator.executablePath;
    const stdPath = stdExe.executablePath;
    const testPath = testExe.executablePath;
    const timeout = timeLimit || 5000;

    const cores = os.cpus().length;
    const B = Math.max(1, Math.min(8, Math.floor(cores / 2)));
    const batchSize = threadCount && threadCount > 0 ? Math.min(threadCount, B) : B;

    let next = 0;
    let done = 0, errors = 0

    // 预启动第一批 gen
    let genBatchPromise = Promise.all(
        Array.from({ length: Math.min(batchSize, totalTests) }, () => runGen(genPath, timeout))
    );

    const compareResults = [];

    while (next < totalTests) {
        const batch = Math.min(batchSize, totalTests - next);
        const gens = await genBatchPromise;

        // 立即预启动下一批 gen (与当前 std+test 计算重叠)
        const remaining = totalTests - (next + batch);
        genBatchPromise = remaining > 0 ? Promise.all(
            Array.from({ length: Math.min(batchSize, remaining) }, () => runGen(genPath, timeout))
        ) : Promise.resolve([]);

        // 并行运行 std+test
        const pairs = await Promise.all(
            Array.from({ length: batch }, (_, k) => runStdTest(stdPath, testPath, gens[k].output, timeout))
        );

        for (let k = 0; k < batch; k++) {
            const idx = next + k;
            const g = gens[k];
            const p = pairs[k];
            if (!g.ok) { errors++; this.emit('error', { testIndex: idx, kind: 'generator', message: 'gen fail' }); continue; }
            if (!p.ok) {
                errors++;
                this.emit('error', { testIndex: idx, kind: 'result', message: 'std/test fail' });
                continue;
            }
            const stdOut = trimBuf(p.stdOut);
            const testOut = trimBuf(p.testOut);
            if (!stdOut.equals(testOut)) {
                errors++;
                this.emit('error', { testIndex: idx, kind: 'mismatch', message: 'WA', stdOutput: stdOut.toString('utf8', 0, 200), testOutput: testOut.toString('utf8', 0, 200) });
            } else {
                done++;
                compareResults.push(idx);
                this.emit('progress', { current: done, total: totalTests });
            }
        }
        next += batch;
    }

    this.emit('complete', { completed: done, total: totalTests, errors });
    return { completed: done, errors };
};

module.exports = { CompareEngineV9 };v9

// 兼容 V2 的 IPC 使用方式
module.exports = { CompareEngineV9 };