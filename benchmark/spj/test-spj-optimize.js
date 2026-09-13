/**
 * test-spj-optimize.js — Step 2: Quantify SPJ optimization potential
 *
 * Compares two SPJ calling patterns:
 *   A) Original IPC pattern: child_process spawn + write stdin (as OICPP judgeWithSpj uses)
 *   B) V10 native fastspawn.run: stdin buffer mode (as V10 engine would use)
 *
 * Both run the same spj_diff binary with the same SPJ input data.
 * Measures per-test wall overhead and TPS delta.
 */
const path = require('path');
const { spawn } = require('child_process');

const PROGS = path.join(__dirname, '..', '..', 'compare-benchmark', 'progs');
const SPJ_BIN = path.join(__dirname, 'spj_diff');
const TOTAL = 50;
const GEN_TIMEOUT = 5000;
const RUN_TIMEOUT = 10000;
const SPJ_TIMEOUT = 5000;

let fast = null;
try { fast = require(path.join(__dirname, '..', '..', 'fastspawn.node')); } catch(e) { console.error('fastspawn.node not available:', e.message); }

// ── Utility ──
function runProgram(exePath, input, timeout) {
    return new Promise((resolve) => {
        const t0 = Date.now();
        let child;
        try {
            child = spawn(exePath, [], { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
        } catch (e) {
            return resolve({ code: -1, error: e.message, ms: 0, timeout: false, output: Buffer.alloc(0) });
        }
        const stdoutChunks = [];
        let killed = false, settled = false;
        const timer = setTimeout(() => {
            killed = true;
            try { child.kill('SIGKILL'); } catch (_) {}
        }, timeout || 60000);
        child.stdout.on('data', (c) => { if (!killed) stdoutChunks.push(c); });
        child.stderr.on('data', () => {});
        child.on('error', (e) => {
            if (!settled) { settled = true; clearTimeout(timer);
                resolve({ code: -1, error: e.message, ms: Date.now() - t0, timeout: killed, output: Buffer.alloc(0) }); }
        });
        child.on('close', (code) => {
            if (!settled) { settled = true; clearTimeout(timer);
                resolve({ code, ms: Date.now() - t0, timeout: killed, output: Buffer.concat(stdoutChunks), error: killed ? 'TLE' : null }); }
        });
        if (input && input.length > 0) child.stdin.write(input);
        child.stdin.end();
    });
}

function buildSpjInput(expectedBuf, actualBuf) {
    const N = Buffer.from(String(expectedBuf.length) + '\n');
    return Buffer.concat([N, expectedBuf, actualBuf]);
}

// ── Generate test data ──
async function generateTestData(count) {
    const tests = [];
    for (let i = 0; i < count; i++) {
        const genR = await runProgram(path.join(PROGS, 'gen_sort'), '', GEN_TIMEOUT);
        const input = genR.output;
        const stdR = await runProgram(path.join(PROGS, 'sort_std'), input, RUN_TIMEOUT);
        const testR = await runProgram(path.join(PROGS, 'sort_mergesort'), input, RUN_TIMEOUT);
        tests.push({
            expected: stdR.output,
            actual: testR.output,
            spjInput: buildSpjInput(stdR.output, testR.output)
        });
        process.stdout.write(`\r  Generating: ${i + 1}/${count}`);
    }
    console.log('');
    return tests;
}

// ── Pattern A: Original child_process spawn (serial, stdin pipe) ──
async function patternA_OriginalSpawn(tests) {
    let ac = 0, wa = 0, other = 0;
    const perTestMs = [];
    const t0 = Date.now();
    for (let i = 0; i < tests.length; i++) {
        const t1 = Date.now();
        const r = await runProgram(SPJ_BIN, tests[i].spjInput, SPJ_TIMEOUT);
        const ms = Date.now() - t1;
        perTestMs.push(ms);
        if (r.code === 0) ac++;
        else if (r.code === 1) wa++;
        else other++;
    }
    const wallMs = Date.now() - t0;
    const avgMs = perTestMs.reduce((a, b) => a + b, 0) / perTestMs.length;
    const p50 = perTestMs.sort((a, b) => a - b)[Math.floor(perTestMs.length / 2)];
    const p99 = perTestMs.sort((a, b) => a - b)[Math.floor(perTestMs.length * 0.99)];
    return { ac, wa, other, wallMs, tps: ac / wallMs * 1000, avgMs, p50, p99 };
}

// ── Pattern B: V10 fastspawn.run (stdin buffer, native) ──
async function patternB_FastspawnRun(tests) {
    if (!fast) throw new Error('fastspawn.node not available');
    let ac = 0, wa = 0, other = 0;
    const perTestMs = [];
    const t0 = Date.now();
    for (let i = 0; i < tests.length; i++) {
        const t1 = Date.now();
        const r = fast.run(SPJ_BIN, tests[i].spjInput, SPJ_TIMEOUT);
        const ms = Date.now() - t1;
        perTestMs.push(ms);
        if (r.code === -3) other++; // timeout
        else if (r.code === 0) ac++;
        else if (r.code === 1) wa++;
        else other++;
    }
    const wallMs = Date.now() - t0;
    const avgMs = perTestMs.reduce((a, b) => a + b, 0) / perTestMs.length;
    const sorted = [...perTestMs].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length / 2)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    return { ac, wa, other, wallMs, tps: ac / wallMs * 1000, avgMs, p50, p99 };
}

// ── Main ──
async function main() {
    console.log('== SPJ Optimization Quantification (Step 2) ==');
    console.log('CPU: require("os").cpus()[0]?.model: see below');
    const os = require('os');
    console.log('CPU: ' + (os.cpus()[0]?.model || '?') + ' x' + os.cpus().length);
    console.log('Tests: ' + TOTAL);
    console.log('');

    // Generate test data
    console.log('[1] Generating test data...');
    const tests = await generateTestData(TOTAL);

    // Show sample SPJ input size
    const sampleSize = tests[0].spjInput.length;
    console.log(`  SPJ input size per test: ${(sampleSize / 1024).toFixed(1)} KB`);
    console.log('');

    // Pattern A
    console.log('[2] Pattern A: Original child_process spawn (stdin pipe, serial)...');
    const resultA = await patternA_OriginalSpawn(tests);
    console.log(`  AC=${resultA.ac}/${TOTAL}  Wall=${resultA.wallMs}ms  TPS=${resultA.tps.toFixed(2)}  avg=${resultA.avgMs.toFixed(2)}ms  p50=${resultA.p50}ms  p99=${resultA.p99}ms`);
    console.log('');

    // Pattern B
    if (fast) {
        console.log('[3] Pattern B: fastspawn.run (native, stdin buffer, serial)...');
        const resultB = await patternB_FastspawnRun(tests);
        console.log(`  AC=${resultB.ac}/${TOTAL}  Wall=${resultB.wallMs}ms  TPS=${resultB.tps.toFixed(2)}  avg=${resultB.avgMs.toFixed(2)}ms  p50=${resultB.p50}ms  p99=${resultB.p99}ms`);
        console.log('');

        // Comparison
        console.log('== Comparison ==');
        const speedup = (resultB.tps / resultA.tps - 1) * 100;
        const wallDelta = resultA.wallMs - resultB.wallMs;
        const perTestDelta = resultA.avgMs - resultB.avgMs;
        console.log(`  Original spawn:     ${resultA.tps.toFixed(2)} TPS  avg ${resultA.avgMs.toFixed(2)} ms/test`);
        console.log(`  fastspawn.run:      ${resultB.tps.toFixed(2)} TPS  avg ${resultB.avgMs.toFixed(2)} ms/test`);
        console.log(`  Speedup:            ${speedup > 0 ? '+' : ''}${speedup.toFixed(1)}%`);
        console.log(`  Per-test saving:    ${perTestDelta.toFixed(2)} ms`);
        console.log(`  Total wall saving:  ${wallDelta} ms`);
        console.log('');
        if (speedup > 20) {
            console.log(`  >> CONCLUSION: fastspawn.run is ${speedup.toFixed(0)}% faster for SPJ calls.`);
            console.log(`     If SPJ were routed through V10 engine, each SPJ call would save ~${perTestDelta.toFixed(1)}ms.`);
        } else if (speedup > 0) {
            console.log(`  >> CONCLUSION: fastspawn.run is modestly faster (${speedup.toFixed(0)}%).`);
            console.log(`     The overhead is mainly in the SPJ binary execution itself, not the spawn mechanism.`);
        } else {
            console.log(`  >> CONCLUSION: No significant difference. Overhead is in the SPJ binary, not the spawn.`);
        }
    } else {
        console.log('[3] SKIPPED: fastspawn.node not available');
    }

    console.log('');
    console.log('== Done ==');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
