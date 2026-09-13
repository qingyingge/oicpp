/**
 * bench-logged.js — 带完整日志的基准测试 runner
 *
 * 每个测试详细记录 (JSONL 文件 + stdout 汇总):
 *   - 时间戳、场景、线程号、测试号
 *   - 成功/失败、失败类型 (generator/std_re/std_tle/test_re/test_tle/mismatch/exception)
 *   - gen/std/test 各阶段耗时 (ms)、gen 输出大小 (bytes)
 *
 * 用法: node benchmark/bench-logged.js [--quick] [--engine v6|v3] [--log bench.jsonl] [--stagger OFFSET]
 * 默认: 3 场景 x 8 线程 x 50 测试, V6 原生引擎
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Worker } = require('worker_threads');

const PROGS = path.join(__dirname, '..', 'compare-benchmark', 'progs');
const LOG_DIR = path.join(__dirname, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const ENGINE = (() => {
    const i = args.indexOf('--engine');
    return i >= 0 ? args[i + 1] : 'v6';
})();
const LOG_ARG = (() => {
    const i = args.indexOf('--log');
    return i >= 0 ? args[i + 1] : null;
})();
const STAGGER = (() => {
    const i = args.indexOf('--stagger');
    return i >= 0 ? parseInt(args[i + 1] || '0', 10) : 0;
})();

const WORKER = path.join(__dirname, '..', 'src', 'main-process', 
    ENGINE === 'v6' ? 'compare-worker-v6.js' : 
    ENGINE === 'aff' ? 'compare-worker-v6-aff.js' : 'compare-worker.js');
const SCENARIOS = QUICK
    ? [['Sort', 'gen_sort', 'sort_std', 'sort_mergesort', 10000, 10]]
    : [
        ['Sort', 'gen_sort', 'sort_std', 'sort_mergesort', 10000, 50],
        ['Graph', 'gen_graph', 'sp_dijkstra', 'sp_spfa', 5000, 50],
        ['Range', 'gen_range', 'range_bit', 'range_segtree', 10000, 50],
      ];
const THREADS = parseInt(args[args.indexOf('--threads') + 1] || '', 10) || os.cpus().length;

function runScenario(scenario) {
    const [label, g, a, b, tl, total] = scenario;
    return new Promise((resolve) => {
        const t0 = Date.now();
        const rows = [];
        const workers = [];
        let msgs = 0;

        const commit = () => {
            if (msgs < THREADS) return;
            workers.forEach(w => { try { w.terminate(); } catch(_) {} });
            const wallMs = Date.now() - t0;
            const ok = rows.filter(r => r.ok).length;
            const fail = rows.filter(r => !r.ok);
            const summary = {
                engine: ENGINE, scenario: label, threads: THREADS, total,
                wallMs, tps: +(ok / wallMs * 1000).toFixed(2), ok, failed: fail.length,
                failByKind: fail.reduce((m, r) => { m[r.kind] = (m[r.kind] || 0) + 1; return m; }, {}),
                genMsAvg: +(rows.reduce((s, r) => s + (r.genMs || 0), 0) / rows.length).toFixed(1),
                stdMsAvg: +(rows.reduce((s, r) => s + (r.stdMs || 0), 0) / rows.length).toFixed(1),
                testMsAvg: +(rows.reduce((s, r) => s + (r.testMs || 0), 0) / rows.length).toFixed(1),
                genLenAvg: +(rows.reduce((s, r) => s + (r.genLen || 0), 0) / rows.length).toFixed(0),
            };
            resolve({ summary, rows });
        };

        const per = Math.ceil(total / THREADS);
        for (let t = 0; t < THREADS; t++) {
            const w = new Worker(WORKER);
            workers.push(w);
            w.on('message', (m) => {
                if (m.type === 'progress' || m.type === 'error') {
                    rows.push({
                        ts: Date.now(), scenario: label, thread: t, testIndex: m.testIndex,
                        ok: m.type === 'progress', kind: m.type === 'progress' ? 'ok' : m.kind,
                        message: m.message || '', genMs: m.genMs, stdMs: m.stdMs, testMs: m.testMs,
                        genLen: m.genLen, stdOutput: m.stdOutput || '', testOutput: m.testOutput || ''
                    });
                } else if (m.type === 'done') {
                    msgs++;
                    commit();
                }
            });
            w.on('error', (e) => {
                rows.push({ ts: Date.now(), scenario: label, thread: t, testIndex: -1, ok: false, kind: 'worker_crash', message: e.message });
                msgs++;
                commit();
            });
            const delay = t * STAGGER;
            setTimeout(() => {
                w.postMessage({
                    type: 'run-tests', startIdx: t * per + 1,
                    count: Math.min(per, total - t * per),
                    genPath: path.join(PROGS, g), stdPath: path.join(PROGS, a), testPath: path.join(PROGS, b),
                    timeout: tl,
                    threadIdx: t
                });
            }, delay);
        }
    });
}

async function main() {
    console.log('== OICPP Compare Benchmark (logged) ==');
    console.log('   engine: ' + ENGINE + '   threads: ' + THREADS + '   cpu: ' + os.cpus().length + 'x');
    console.log('   logdir: ' + LOG_DIR + '\n');

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const logFile = LOG_ARG || path.join(LOG_DIR, `run-${stamp}.jsonl`);

    const all = [];
    for (const s of SCENARIOS) {
        const { summary, rows } = await runScenario(s);
        all.push(summary);

        for (const r of rows) {
            fs.appendFileSync(logFile, JSON.stringify(r) + '\n');
        }
        fs.appendFileSync(logFile, JSON.stringify({ type: 'summary', ...summary }) + '\n');

        console.log(`  ${summary.scenario.padEnd(6)} ${summary.ok}/${summary.total}  ${summary.wallMs}ms  ${summary.tps.toFixed(1)} TPS  ` +
            `gen=${summary.genMsAvg}ms std=${summary.stdMsAvg}ms test=${summary.testMsAvg}ms genLen=${summary.genLenAvg}B  ` +
            `fail=${summary.failed ? JSON.stringify(summary.failByKind) : '0'}`);
    }

    console.log('\n  log written to: ' + logFile);
    console.log('\n== Summary ==');
    console.log('  scenario   TPS      ok/fail   wall(ms)');
    for (const s of all) {
        console.log(`  ${s.scenario.padEnd(10)} ${String(s.tps).padStart(6)}   ${String(s.ok).padStart(3)}/${String(s.failed).padEnd(3)}   ${String(s.wallMs).padStart(6)}`);
    }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });