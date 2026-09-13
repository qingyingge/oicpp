/**
 * spj-worker-v10.js — V10 Native SPJ worker using fastspawn.node
 * Receives { type: 'run-spj', spjBin, tests: [{index, spjInput: Buffer}], timeout }
 * Posts back { type: 'spj-result', index, verdict } or { type: 'spj-error', index, error }
 */
const { parentPort } = require('worker_threads');
const path = require('path');

let fast = null;
try { fast = require(path.join(__dirname, '..', '..', '..', 'fastspawn.node')); } catch(e) {}

parentPort.on('message', async (msg) => {
    if (msg.type === 'run-spj') {
        const { spjBin, tests, timeout } = msg;
        for (const t of tests) {
            try {
                const t0 = Date.now();
                let verdict, ms;
                if (fast) {
                    // Use native fastspawn.run with stdin buffer
                    const r = fast.run(spjBin, t.spjInput, timeout);
                    ms = Date.now() - t0;
                    if (r.code === -3) verdict = 'TLE';
                    else if (r.code === 0) verdict = 'AC';
                    else if (r.code === 1) verdict = 'WA';
                    else verdict = 'RE';
                } else {
                    // Fallback to child_process spawn
                    const { spawn } = require('child_process');
                    const child = spawn(spjBin, [], { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
                    const stdoutChunks = [];
                    let killed = false, settled = false;
                    const result = await new Promise((resolve) => {
                        const timer = setTimeout(() => { killed = true; try { child.kill('SIGKILL'); } catch(_){} }, timeout);
                        child.stdout.on('data', c => { if (!killed) stdoutChunks.push(c); });
                        child.stderr.on('data', () => {});
                        child.on('close', code => { if (!settled) { settled = true; clearTimeout(timer); resolve({ code, timeout: killed }); }});
                        child.on('error', e => { if (!settled) { settled = true; clearTimeout(timer); resolve({ code: -1, timeout: false }); }});
                        child.stdin.write(t.spjInput);
                        child.stdin.end();
                    });
                    ms = Date.now() - t0;
                    if (result.timeout) verdict = 'TLE';
                    else if (result.code === 0) verdict = 'AC';
                    else if (result.code === 1) verdict = 'WA';
                    else verdict = 'RE';
                }
                parentPort.postMessage({ type: 'spj-result', index: t.index, verdict, ms });
            } catch (e) {
                parentPort.postMessage({ type: 'spj-error', index: t.index, error: e.message });
            }
        }
    }
});
