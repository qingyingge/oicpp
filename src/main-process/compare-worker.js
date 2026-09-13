/**
 * compare-worker.js — V3 Pipeline Worker
 *
 * 关键优化: 预启动 spawn
 *   1. gen 无 stdin 依赖，提前 spawn → 输出 ready 等待
 *   2. std/test 阻塞在 stdin.read()，提前 spawn → 等待输入
 *   3. gen 输出到了 → 写入 std/test stdin → 同时 respawn 下一轮
 *   4. spawn 与 CPU 计算完全重叠
 */
const { parentPort } = require('worker_threads');
const { spawn } = require('child_process');

function spawnProcess(exePath) {
    return new Promise((resolve) => {
        const proc = spawn(exePath, [], {
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true
        });
        proc.stdin.on('error', () => {});
        proc.stderr.on('error', () => {});
        const stdout = [];
        const stderr = [];
        proc.stdout.on('data', d => stdout.push(d));
        proc.stderr.on('data', d => stderr.push(d));

        proc._result = null;
        proc._done = false;
        proc._collectors = [];

        proc.on('close', (code) => {
            let out = '';
            try { out = Buffer.concat(stdout).toString('utf8').trim(); } catch(_) { out = Buffer.concat(stdout).toString('latin1').trim(); }
            proc._result = { output: out, exitCode: code };
            proc._done = true;
            for (const cb of proc._collectors) cb(proc._result);
            proc._collectors = [];
        });

        proc.on('error', (err) => {
            proc._result = { output: '', exitCode: -1, error: err.message };
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
        const cb = (result) => {
            if (timer) { clearTimeout(timer); timer = null; }
            resolve(result);
        };
        proc._collectors.push(cb);
        if (timeout > 0) {
            timer = setTimeout(() => {
                proc._collectors = proc._collectors.filter(c => c !== cb);
                try { proc.kill('SIGKILL'); } catch(_) {}
                resolve({ output: '', exitCode: -1, timeout: true, error: 'timeout' });
            }, timeout);
        }
    });
}

function writeInput(proc, input) {
    return new Promise((resolve) => {
        try {
            if (proc.stdin.destroyed || proc.stdin.writableEnded) { resolve(false); return; }
            proc.stdin.write(input);
            proc.stdin.end();
            resolve(true);
        } catch(_) { resolve(false); }
    });
}

function killProc(proc) {
    try { proc.kill('SIGKILL'); } catch(_) {}
}

// Pre-spawned process slots
let nextGen = null;
let nextStd = null;
let nextTest = null;

async function preSpawnGen(exePath) {
    nextGen = await spawnProcess(exePath);
}

async function preSpawnStd(exePath) {
    nextStd = await spawnProcess(exePath);
}

async function preSpawnTest(exePath) {
    nextTest = await spawnProcess(exePath);
}

let running = false;

parentPort.on('message', async (msg) => {
    if (msg.type === 'run-tests') {
        running = true;
        const { startIdx, count, genPath, stdPath, testPath, timeout } = msg;

        // Phase 0: 预启动第一批 gen
        await preSpawnGen(genPath);

        for (let i = startIdx; i < startIdx + count && running; i++) {
            try {
                // Phase 1: 等 gen 输出 + 同时预启动下一轮 std/test
                const [stdReady, testReady] = await Promise.all([
                    preSpawnStd(stdPath),
                    preSpawnTest(testPath)
                ]);

                const genResult = await waitForResult(nextGen, 5000);

                // Phase 2: 预启动下一轮 gen (与 std/test 计算重叠)
                const nextGenPromise = preSpawnGen(genPath);

                if (genResult.exitCode !== 0 || genResult.timeout) {
                    parentPort.postMessage({ type: 'error', testIndex: i, kind: 'generator', message: genResult.error || 'gen fail (exit ' + genResult.exitCode + ')' });
                    killProc(nextStd);
                    killProc(nextTest);
                    nextStd = null;
                    nextTest = null;
                    await nextGenPromise;
                    continue;
                }

                // Phase 3: 写入 std/test stdin (进程已经在等了)
                const input = genResult.output;
                await Promise.all([
                    writeInput(nextStd, input),
                    writeInput(nextTest, input)
                ]);

                // Phase 4: 等 std/test 结果
                const [stdResult, testResult] = await Promise.all([
                    waitForResult(nextStd, timeout),
                    waitForResult(nextTest, timeout)
                ]);

                // Phase 5: 预启动下一轮 std/test (后台)
                await nextGenPromise;

                if (stdResult.timeout) { parentPort.postMessage({ type: 'error', testIndex: i, kind: 'std_tle', message: 'std TLE' }); continue; }
                if (stdResult.error) { parentPort.postMessage({ type: 'error', testIndex: i, kind: 'std_re', message: stdResult.error }); continue; }
                if (stdResult.exitCode !== 0 && stdResult.exitCode !== null) { parentPort.postMessage({ type: 'error', testIndex: i, kind: 'std_re', message: 'std exit ' + stdResult.exitCode }); continue; }

                if (testResult.timeout) { parentPort.postMessage({ type: 'error', testIndex: i, kind: 'test_tle', message: 'test TLE' }); continue; }
                if (testResult.error) { parentPort.postMessage({ type: 'error', testIndex: i, kind: 'test_re', message: testResult.error }); continue; }
                if (testResult.exitCode !== 0 && testResult.exitCode !== null) { parentPort.postMessage({ type: 'error', testIndex: i, kind: 'test_re', message: 'test exit ' + testResult.exitCode }); continue; }

                if (stdResult.output.trim() !== testResult.output.trim()) {
                    parentPort.postMessage({ type: 'error', testIndex: i, kind: 'mismatch', message: 'WA',
                        stdOutput: stdResult.output.substring(0, 200), testOutput: testResult.output.substring(0, 200) });
                    continue;
                }

                parentPort.postMessage({ type: 'progress', testIndex: i });
            } catch(e) {
                parentPort.postMessage({ type: 'error', testIndex: i, kind: 'exception', message: e.message });
            }
        }

        if (nextGen) killProc(nextGen);
        if (nextStd) killProc(nextStd);
        if (nextTest) killProc(nextTest);
        nextGen = null; nextStd = null; nextTest = null;

        parentPort.postMessage({ type: 'done' });
    } else if (msg.type === 'stop') {
        running = false;
    }
});
