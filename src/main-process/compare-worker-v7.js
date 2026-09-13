/**
 * compare-worker-v7.js — V7 Native-spawn + Async Pipes
 * 结合 V3 的管线重叠与 V6 的 posix_spawn:
 *   - spawn 用原生 posix_spawn (~1ms, 不阻塞事件循环)
 *   - 管道 IO 用 Node 异步流 (不阻塞线程)
 *   - 每迭代预启动下一轮 3 进程, 与当前 std/test 计算重叠
 */
const { parentPort } = require('worker_threads');
const fs = require('fs');

let fast = null;
try { fast = require('../../fastspawn.node'); } catch(_) {}

const { spawn: jsSpawn } = require('child_process');

function spawnNative(exePath) {
    const s = fast.spawn(exePath);
    const stdout = fs.createReadStream(null, { fd: s.stdoutFd, autoClose: true });
    const stderr = fs.createReadStream(null, { fd: s.stderrFd, autoClose: true });
    const stdin = fs.createWriteStream(null, { fd: s.stdinFd, autoClose: true });
    const outChunks = [], errChunks = [];
    stdout.on('data', d => outChunks.push(d));
    stderr.on('data', d => errChunks.push(d));
    const proc = {
        pid: s.pid, stdin, stdout, stderr,
        _collectors: [],
        _done: false,
        _result: null,
        _collect: () => Buffer.concat(outChunks),
        kill: () => { try { process.kill(s.pid, 'SIGKILL'); } catch(_) {} }
    };
    const onClose = () => {
        if (proc._done) return;
        proc._done = true;
        proc._result = { exitCode: fast.waitpid(s.pid) };
        for (const cb of proc._collectors) cb(proc._result);
        proc._collectors = [];
    };
    stdout.on('close', onClose);
    stderr.on('close', onClose);
    return proc;
}

function spawnJs(exePath) {
    return new Promise((resolve) => {
        const proc = jsSpawn(exePath, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        const outChunks = [];
        proc.stdout.on('data', d => outChunks.push(d));
        proc._collect = () => Buffer.concat(outChunks);
        proc._collectors = [];
        proc._done = false;
        proc._result = null;
        proc.on('close', (code) => { proc._result = { exitCode: code }; proc._done = true; for (const cb of proc._collectors) cb(proc._result); proc._collectors = []; });
        proc.on('error', (err) => { proc._result = { exitCode: -1, error: err.message }; proc._done = true; for (const cb of proc._collectors) cb(proc._result); proc._collectors = []; });
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

function killProc(proc) { try { proc.kill(); } catch(_) {} }

function writeInput(proc, input) {
    return new Promise((resolve) => {
        try {
            proc.stdin.write(input);
            proc.stdin.end();
            resolve(true);
        } catch(_) { resolve(false); }
    });
}

let running = false;
let nextGen = null, nextStd = null, nextTest = null;

parentPort.on('message', async (msg) => {
    if (msg.type === 'run-tests') {
        running = true;
        const { startIdx, count, genPath, stdPath, testPath, timeout } = msg;
        const useFast = !!fast;
        const doSpawn = useFast ? spawnNative : spawnJs;
        nextGen = await doSpawn(genPath);
        let spawnNext = Promise.resolve();

        for (let i = startIdx; i < startIdx + count && running; i++) {
            try {
                const genResult = await waitForResult(nextGen, 5000);
                if (genResult.timeout || genResult.error || genResult.exitCode !== 0) {
                    parentPort.postMessage({ type: 'error', testIndex: i, kind: 'generator', message: genResult.error || 'gen fail' });
                    nextGen = await doSpawn(genPath);
                    continue;
                }
                const input = nextGen._collect();
                if (nextStd && nextTest) {
                    await Promise.all([writeInput(nextStd, input), writeInput(nextTest, input)]);
                }
                const curStd = nextStd, curTest = nextTest;

                const spawnNext = (async () => {
                    const [g, s, t] = await Promise.all([doSpawn(genPath), doSpawn(stdPath), doSpawn(testPath)]);
                    nextGen = g; nextStd = s; nextTest = t;
                })();

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
                    if (!stdOut.equals(testOut)) {
                        parentPort.postMessage({ type: 'error', testIndex: i, kind: 'mismatch', message: 'WA', stdOutput: stdOut.toString('utf8', 0, 200), testOutput: testOut.toString('utf8', 0, 200) });
                    } else {
                        parentPort.postMessage({ type: 'progress', testIndex: i });
                    }
                }

                await spawnNext.catch(() => {});
            } catch(e) {
                parentPort.postMessage({ type: 'error', testIndex: i, kind: 'exception', message: e.message });
            }
        }

        await spawnNext.catch(() => {});
        if (nextGen) killProc(nextGen);
        if (nextStd) killProc(nextStd);
        if (nextTest) killProc(nextTest);
        parentPort.postMessage({ type: 'done' });
    } else if (msg.type === 'stop') {
        running = false;
    }
});