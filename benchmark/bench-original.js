/**
 * bench-original.js — 原版 runProgram IPC 架构的干净环境等价模拟
 * 与 src/main.js 的 'run-program' handler 语义一致：
 * child_process.spawn(绝对路径) + pipe 三路 + 写输入 + 收集输出 + 超时 SIGKILL
 * 逐测试串行: gen → std → test, 无并行无预启动。
 *
 * 用法: node benchmark/bench-original.js [--quick]
 */
const path = require('path');
const { spawn } = require('child_process');

const PROGS = path.join(__dirname, '..', 'compare-benchmark', 'progs');
const QUICK = process.argv.includes('--quick');
const SCENARIOS = QUICK
    ? [['Sort', 'gen_sort', 'sort_std', 'sort_mergesort', 10000, 10]]
    : [
        ['Sort', 'gen_sort', 'sort_std', 'sort_mergesort', 10000, 50],
        ['Graph', 'gen_graph', 'sp_dijkstra', 'sp_spfa', 5000, 50],
        ['Range', 'gen_range', 'range_bit', 'range_segtree', 10000, 50],
      ];

function runProgram(exePath, input, timeLimit) {
    return new Promise((resolve) => {
        const t0 = Date.now();
        let child;
        try {
            child = spawn(path.resolve(exePath), [], { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
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

async function runScenario([label, g, a, b, tl, total]) {
    const t0 = Date.now();
    let ok = 0, fails = [];
    for (let i = 1; i <= total; i++) {
        const genR = await runProgram(path.join(PROGS, g), '', 5000);
        if (genR.timeout || genR.error || genR.code !== 0) { fails.push({ i, kind: 'generator' }); continue; }
        const stdR = await runProgram(path.join(PROGS, a), genR.output, tl);
        if (stdR.timeout || stdR.error || stdR.code !== 0) { fails.push({ i, kind: stdR.timeout ? 'std_tle' : 'std_re' }); continue; }
        const testR = await runProgram(path.join(PROGS, b), genR.output, tl);
        if (testR.timeout || testR.error || testR.code !== 0) { fails.push({ i, kind: testR.timeout ? 'test_tle' : 'test_re' }); continue; }
        if (!stdR.output.equals(testR.output)) { fails.push({ i, kind: 'mismatch' }); continue; }
        ok++;
    }
    const wallMs = Date.now() - t0;
    console.log(`  ${label.padEnd(6)} ${ok}/${total}  ${wallMs}ms  ${(ok / wallMs * 1000).toFixed(1)} TPS  fail=${fails.length ? JSON.stringify(fails.slice(0, 3)) : '0'}`);
}

async function main() {
    console.log('== 原版 runProgram IPC 架构 (干净环境, 串行) ==');
    for (const s of SCENARIOS) await runScenario(s);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });