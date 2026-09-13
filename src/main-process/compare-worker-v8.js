/**
 * compare-worker-v8.js — V8 Native-spawn + Async Pipes + Pipeline
 * 保留 V3 的预启动管线重叠 (spawn 与计算重叠)
 * 但 spawn 换成本地 posix_spawn (7ms vs 17ms)
 * 管道用 Node 异步流 (不阻塞线程), 比较用 Buffer (无 2MB toString)
 */
const { parentPort } = require('worker_threads');
const fs = require('fs');

let fast = null;
try { fast = require('../../fastspawn.node'); } catch(_) {}

const { spawn: jsSpawn } = require('child_process');

function spawnNative(exePath) {
    const s = fast.spawn(exePath);
    const outChunks = [];
    const stdout = fs.createReadStream(null, { fd: s.stdoutFd, autoClose: false });
    stdout.on('data', d => outChunks.push(d));
    const stdin = fs.createWriteStream(null, { fd: s.stdinFd, autoClose: false });
    stdin._fd = s.stdinFd;
    const proc = {
        pid: s.pid, stdin, stdout, _stdinFd: s.stdinFd,
        _collectors: [], _done: false, _result: null,
        _collect: () => { const b = Buffer.concat(outChunks); return b.length ? b : Buffer.alloc(0); },
        kill: () => { try { process.kill(s.pid, 'SIGKILL'); } catch(_) {} },
        _reap: () => {
            if (proc._done) return;
            const r0 = Date.now();
            const code = fast.waitpidBlocking(s.pid, 3000);
            if (code === -3) parentPort.postMessage({ type: 'debug', e: 'REAP-TIMEOUT pid=' + s.pid + ' wait=' + (Date.now()-r0) + 'ms' });
            else if (Date.now() - r0 > 200) parentPort.postMessage({ type: 'debug', e: 'REAP-SLOW pid=' + s.pid + ' code=' + code + ' wait=' + (Date.now()-r0) + 'ms' });
            try { fs.closeSync(s.stdoutFd); } catch(_) {}
            try { fs.closeSync(s.stderrFd); } catch(_) {}
            try { fs.closeSync(s.stdinFd); } catch(_) {}
            proc._done = true;
            proc._result = { exitCode: code };
            for (const cb of proc._collectors) cb(proc._result);
            proc._collectors = [];
        }
    };
    stdout.on('end', () => proc._reap());
    stdout.on('close', () => proc._reap());
    stdout.on('error', () => proc._reap());
    return proc;
}

function spawnJs(exePath) {
    return new Promise((resolve) => {
        const proc = jsSpawn(exePath, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        proc.stdin.on('error', () => {});
        proc.stderr.on('error', () => {});
        const outChunks = [];
        proc.stdout.on('data', d => outChunks.push(d));
        proc._collect = () => { const b = Buffer.concat(outChunks); return b.length ? b : Buffer.alloc(0); };
        proc._collectors = []; proc._done = false; proc._result = null;
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
            if (proc.stdin.destroyed || proc.stdin.writableEnded) { resolve(false); return; }
            proc.stdin.write(input, () => {
                try { proc.stdin.end(); } catch(_) {}
                if (proc._stdinFd) { try { fs.closeSync(proc._stdinFd); } catch(_) {} proc._stdinFd = null; }
            });
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

let running = false;
let nextGen = null, nextStd = null, nextTest = null;
let genPath = null, stdPath = null, testPath = null;

parentPort.on('message', async (msg) => {
    if (msg.type === 'run-tests') {
        running = true;
        const { startIdx, count, genPath: gp, stdPath: sp, testPath: tp, timeout } = msg;
        genPath = gp; stdPath = sp; testPath = tp;
        const useFast = !!fast;
        const doSpawn = useFast ? spawnNative : spawnJs;
        nextGen = await doSpawn(genPath);
        const [s0, t0] = await Promise.all([doSpawn(stdPath), doSpawn(testPath)]);
        nextStd = s0; nextTest = t0;
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

                spawnNext = (async () => {
                    const [g, s2, t2] = await Promise.all([doSpawn(genPath), doSpawn(stdPath), doSpawn(testPath)]);
                    nextGen = g; nextStd = s2; nextTest = t2;
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
                    const stdOut = trimBuf(curStd._collect());
                    const testOut = trimBuf(curTest._collect());
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