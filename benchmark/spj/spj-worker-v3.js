/**
 * spj-worker-v3.js — V3-style SPJ worker using child_process spawn
 * Receives { type: 'run-spj', spjBin, tests: [{index, spjInput: Buffer}], timeout }
 * Posts back { type: 'spj-result', index, verdict } or { type: 'spj-error', index, error }
 */
const { parentPort } = require('worker_threads');
const { spawn } = require('child_process');

function runSpj(exePath, inputBuf, timeout) {
    return new Promise((resolve) => {
        const t0 = Date.now();
        let child;
        try {
            child = spawn(exePath, [], { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
        } catch (e) {
            return resolve({ code: -1, error: e.message, ms: 0, timeout: false });
        }
        const stdoutChunks = [];
        let killed = false, settled = false;
        const timer = setTimeout(() => {
            killed = true;
            try { child.kill('SIGKILL'); } catch (_) {}
        }, timeout || 5000);
        child.stdout.on('data', (c) => { if (!killed) stdoutChunks.push(c); });
        child.stderr.on('data', () => {});
        child.on('error', (e) => {
            if (!settled) { settled = true; clearTimeout(timer);
                resolve({ code: -1, error: e.message, ms: Date.now() - t0, timeout: killed }); }
        });
        child.on('close', (code) => {
            if (!settled) { settled = true; clearTimeout(timer);
                const out = Buffer.concat(stdoutChunks).toString('utf8').trim();
                resolve({ code, ms: Date.now() - t0, timeout: killed, output: out, error: killed ? 'TLE' : null }); }
        });
        child.stdin.write(inputBuf);
        child.stdin.end();
    });
}

parentPort.on('message', async (msg) => {
    if (msg.type === 'run-spj') {
        const { spjBin, tests, timeout } = msg;
        for (const t of tests) {
            try {
                const r = await runSpj(spjBin, t.spjInput, timeout);
                let verdict;
                if (r.timeout || (r.error === 'TLE')) verdict = 'TLE';
                else if (r.code === 0) verdict = 'AC';
                else if (r.code === 1) verdict = 'WA';
                else verdict = 'RE';
                parentPort.postMessage({ type: 'spj-result', index: t.index, verdict, ms: r.ms });
            } catch (e) {
                parentPort.postMessage({ type: 'spj-error', index: t.index, error: e.message });
            }
        }
    }
});
