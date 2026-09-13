/**
 * compare-worker-v5.js — V5 Fully-Pipelined Pre-Spawn
 *
 * 迭代 N 时序:
 *   1. await spawnNext (上一轮算期内已启动的 spawn, 几乎立即完成)
 *   2. 等 gen 输出 → 写入 pre-spawned std/test
 *   3. 启动下一轮 spawn (与当前 std/test 计算重叠)
 *   4. 等 std/test 结果 → 对比 → 上报
 *
 * 每迭代临界路径: gen运行 + 写入 + std/test计算; 3 个 fork 全部被隐藏.
 */
const { parentPort } = require('worker_threads');
const { spawn } = require('child_process');

function spawnProcess(exePath) {
    return new Promise((resolve) => {
        const proc = spawn(exePath, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        const stdout = [], stderr = [];
        proc.stdout.on('data', d => stdout.push(d));
        proc.stderr.on('data', d => stderr.push(d));
        proc._collect = () => {
            let o = '';
            try { o = Buffer.concat(stdout).toString('utf8'); } catch(_) { o = Buffer.concat(stdout).toString('latin1'); }
            return o.trim();
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

function killProc(proc) { try { proc.kill('SIGKILL'); } catch(_) {} }

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

let running = false;

parentPort.on('message', async (msg) => {
    if (msg.type === 'run-tests') {
        running = true;
        const { startIdx, count, genPath, stdPath, testPath, timeout } = msg;
        let nextGen = null, nextStd = null, nextTest = null;
        nextGen = await spawnProcess(genPath);
        let spawnNext = Promise.resolve();

        for (let i = startIdx; i < startIdx + count && running; i++) {
            try {
                await spawnNext;
                const gen = nextGen;
                const genResult = await waitForResult(gen, 5000);

                if (genResult.timeout || genResult.error || genResult.exitCode !== 0) {
                    parentPort.postMessage({ type: 'error', testIndex: i, kind: 'generator', message: genResult.error || 'gen fail' });
                    spawnNext = Promise.all([spawnProcess(genPath)]).then(([g]) => { nextGen = g; });
                    continue;
                }

                const input = gen._collect();
                if (nextStd && nextTest) {
                    await Promise.all([writeInput(nextStd, input), writeInput(nextTest, input)]);
                }
                const curStd = nextStd;
                const curTest = nextTest;

                spawnNext = Promise.all([
                    spawnProcess(genPath),
                    spawnProcess(stdPath),
                    spawnProcess(testPath)
                ]).then(([g, s, t]) => { nextGen = g; nextStd = s; nextTest = t; });

                const [stdR, testR] = await Promise.all([
                    curStd ? waitForResult(curStd, timeout) : Promise.resolve({ exitCode: -1, error: 'no std' }),
                    curTest ? waitForResult(curTest, timeout) : Promise.resolve({ exitCode: -1, error: 'no test' })
                ]);

                if (stdR.timeout) { killProc(curTest); parentPort.postMessage({ type: 'error', testIndex: i, kind: 'std_tle', message: 'std TLE' }); }
                else if (stdR.error || (stdR.exitCode !== 0 && stdR.exitCode !== null)) { killProc(curTest); parentPort.postMessage({ type: 'error', testIndex: i, kind: 'std_re', message: stdR.error || ('std exit ' + stdR.exitCode) }); }
                else if (testR.timeout) { killProc(curStd); parentPort.postMessage({ type: 'error', testIndex: i, kind: 'test_tle', message: 'test TLE' }); }
                else if (testR.error || (testR.exitCode !== 0 && testR.exitCode !== null)) { killProc(curStd); parentPort.postMessage({ type: 'error', testIndex: i, kind: 'test_re', message: testR.error || ('test exit ' + testR.exitCode) }); }
                else {
                    const stdOut = curStd._collect();
                    const testOut = curTest._collect();
                    if (stdOut !== testOut) {
                        parentPort.postMessage({ type: 'error', testIndex: i, kind: 'mismatch', message: 'WA', stdOutput: stdOut.substring(0, 200), testOutput: testOut.substring(0, 200) });
                    } else {
                        parentPort.postMessage({ type: 'progress', testIndex: i });
                    }
                }
            } catch(e) {
                parentPort.postMessage({ type: 'error', testIndex: i, kind: 'exception', message: e.message });
            }
        }

        await spawnNext.catch(() => {});
        if (nextGen) killProc(nextGen);
        if (nextStd) killProc(nextStd);
        if (nextTest) killProc(nextTest.code);
        parentPort.postMessage({ type: 'done' });
    } else if (msg.type === 'stop') {
        running = false;
    }
});