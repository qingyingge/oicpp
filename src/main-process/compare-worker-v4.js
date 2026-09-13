/**
 * compare-worker-v4.js — V4 Streaming Tee Pipeline
 *
 * 相比 V3 的关键改进:
 *   1. gen.stdout 直接 pipe 到 std/test stdin (tee) — 不再收集大 Buffer 再写回
 *   2. 消除: 1.5MB Buffer.concat + trim + 两次 stdin.write
 *   3. gen 与 std/test 计算完全重叠 (流式处理)
 *   4. spawn 预启动: std/test 提前 fork, 阻塞等 stdin
 */
const { parentPort } = require('worker_threads');
const { spawn } = require('child_process');

function spawnProcess(exePath) {
    return new Promise((resolve) => {
        const proc = spawn(exePath, [], {
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true
        });
        const stdout = [];
        const stderr = [];
        proc.stdout.on('data', d => stdout.push(d));
        proc.stderr.on('data', d => stderr.push(d));
        proc._collect = () => {
            let out = '';
            try { out = Buffer.concat(stdout).toString('utf8'); } catch(_) { out = Buffer.concat(stdout).toString('latin1'); }
            return out.trim();
        };
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

function killProc(proc) {
    try { proc.kill('SIGKILL'); } catch(_) {}
}

let running = false;
let curGen = null;
let curStd = null;
let curTest = null;

parentPort.on('message', async (msg) => {
    if (msg.type === 'run-tests') {
        running = true;
        const { startIdx, count, genPath, stdPath, testPath, timeout } = msg;

        for (let i = startIdx; i < startIdx + count && running; i++) {
            try {
                // Phase 1: spawn gen + std + test 全部并行 (std/test 阻塞等 stdin)
                const [gen, std, test] = await Promise.all([
                    spawnProcess(genPath),
                    spawnProcess(stdPath),
                    spawnProcess(testPath)
                ]);
                curGen = gen; curStd = std; curTest = test;

                // Phase 2: 流式 tee — gen.stdout 直接分发给 std/test
                const genOut = gen.stdout;
                genOut.pipe(std.stdin);
                genOut.pipe(test.stdin);

                // gen 关闭 → 确保 std/test stdin 收到 EOF
                gen._collectors.push(() => {
                    try { std.stdin.end(); } catch(_) {}
                    try { test.stdin.end(); } catch(_) {}
                });

                // Phase 3: 等三进程全部结束
                const [genR, stdR, testR] = await Promise.all([
                    waitForResult(gen, 5000),
                    waitForResult(std, timeout),
                    waitForResult(test, timeout)
                ]);

                if (genR.timeout || genR.error) {
                    killProc(std); killProc(test);
                    parentPort.postMessage({ type: 'error', testIndex: i, kind: 'generator', message: genR.error || 'gen TLE' });
                    continue;
                }
                if (stdR.timeout) { killProc(test); parentPort.postMessage({ type: 'error', testIndex: i, kind: 'std_tle', message: 'std TLE' }); continue; }
                if (stdR.error || (stdR.exitCode !== 0 && stdR.exitCode !== null)) { killProc(test); parentPort.postMessage({ type: 'error', testIndex: i, kind: 'std_re', message: stdR.error || ('std exit ' + stdR.exitCode) }); continue; }
                if (testR.timeout) { killProc(std); parentPort.postMessage({ type: 'error', testIndex: i, kind: 'test_tle', message: 'test TLE' }); continue; }
                if (testR.error || (testR.exitCode !== 0 && testR.exitCode !== null)) { killProc(std); parentPort.postMessage({ type: 'error', testIndex: i, kind: 'test_re', message: testR.error || ('test exit ' + testR.exitCode) }); continue; }

                const stdOut = std._collect();
                const testOut = test._collect();
                if (stdOut !== testOut) {
                    parentPort.postMessage({ type: 'error', testIndex: i, kind: 'mismatch', message: 'WA',
                        stdOutput: stdOut.substring(0, 200), testOutput: testOut.substring(0, 200) });
                    continue;
                }
                parentPort.postMessage({ type: 'progress', testIndex: i });
            } catch(e) {
                parentPort.postMessage({ type: 'error', testIndex: i, kind: 'exception', message: e.message });
            }
        }

        if (curGen) killProc(curGen);
        if (curStd) killProc(curStd);
        if (curTest) killProc(curTest);
        curGen = curStd = curTest = null;

        parentPort.postMessage({ type: 'done' });
    } else if (msg.type === 'stop') {
        running = false;
    }
});