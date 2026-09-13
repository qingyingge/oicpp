const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PROGS = path.join(__dirname, '..', 'compare-benchmark', 'progs');
const TMPDIR = '/tmp/oicpp_e2e_compare';
fs.mkdirSync(TMPDIR, { recursive: true });

function compile(name) {
    return new Promise((resolve, reject) => {
        spawn('g++', ['-O2', '-std=c++14', '-o', path.join(TMPDIR, name), path.join(PROGS, name + '.cpp')], { stdio: 'pipe' })
            .on('close', c => c === 0 ? resolve() : reject(new Error('compile ' + name)));
    });
}

function getTargets() {
    return new Promise((resolve, reject) => {
        http.get('http://127.0.0.1:9222/json', (res) => {
            let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)));
        }).on('error', reject);
    });
}

let msgId = 1;
function ipcInvoke(ws, method, ...args) {
    return new Promise((resolve, reject) => {
        const id = msgId++;
        const handler = (data) => {
            const msg = JSON.parse(data);
            if (msg.id === id) {
                ws.removeListener('message', handler);
                if (msg.error) reject(new Error(msg.error));
                else resolve(msg.result);
            }
        };
        ws.on('message', handler);
        ws.send(JSON.stringify({ id, method, args }));
    });
}

async function run() {
    const P = {};
    for (const n of ['gen_sort','sort_std','sort_mergesort','gen_graph','sp_dijkstra','sp_spfa','gen_range','range_bit','range_segtree'])
        P[n] = await compile(n);

    const IT = 20;
    const scenarios = [
        ['Sort: std vs mergesort', 'gen_sort', 'sort_std', 'sort_mergesort'],
        ['Graph: Dijkstra vs SPFA', 'gen_graph', 'sp_dijkstra', 'sp_spfa'],
        ['Range: BIT vs SegTree', 'gen_range', 'range_bit', 'range_segtree'],
    ];

    console.log('=== NEW ARCH: ' + IT + ' iterations per scenario ===\n');
    console.log('Scenario                    Serial    Parallel   Speedup');
    console.log('----------------------------------------------------------');

    for (const [label, g, a, b] of scenarios) {
        const ser = [], par = [];
        for (let i = 0; i < IT; i++) {
            const t0s = Date.now();
            const gr = spawn(P[g], [], { stdio: ['pipe','pipe','pipe'] });
            let gout = '';
            gr.stdout.on('data', d => gout += d);
            await new Promise(r => gr.on('close', r));
            const input = gout.trim();

            const ar = spawn(P[a], [], { stdio: ['pipe','pipe','pipe'] });
            ar.stdin.write(input); ar.stdin.end();
            let aout = '';
            ar.stdout.on('data', d => aout += d);
            await new Promise(r => ar.on('close', r));
            const sMs = Date.now() - t0s;

            const br = spawn(P[b], [], { stdio: ['pipe','pipe','pipe'] });
            br.stdin.write(input); br.stdin.end();
            let bout = '';
            br.stdout.on('data', d => bout += d);
            await new Promise(r => br.on('close', r));

            const norm = s => s.split('\n').map(l=>l.trimEnd()).join('\n').replace(/\n+$/,'');
            ser.push(sMs);

            const t0p = Date.now();
            const gr2 = spawn(P[g], [], { stdio: ['pipe','pipe','pipe'] });
            let gout2 = '';
            gr2.stdout.on('data', d => gout2 += d);
            await new Promise(r => gr2.on('close', r));
            const input2 = gout2.trim();
            const [ar2, br2] = await Promise.all([
                new Promise((res) => {
                    const r = spawn(P[a], [], { stdio: ['pipe','pipe','pipe'] });
                    r.stdin.write(input2); r.stdin.end();
                    let o = '';
                    r.stdout.on('data', d => o += d);
                    r.on('close', () => res(o));
                }),
                new Promise((res) => {
                    const r = spawn(P[b], [], { stdio: ['pipe','pipe','pipe'] });
                    r.stdin.write(input2); r.stdin.end();
                    let o = '';
                    r.stdout.on('data', d => o += d);
                    r.on('close', () => res(o));
                }),
            ]);
            par.push(Date.now() - t0p);
        }
        const sAvg = (ser.reduce((a,b)=>a+b)/ser.length).toFixed(0);
        const pAvg = (par.reduce((a,b)=>a+b)/par.length).toFixed(0);
        console.log(label.padEnd(28) + sAvg.padStart(7) + 'ms  ' + pAvg.padStart(7) + 'ms  ' + (ser.reduce((a,b)=>a+b)/par.reduce((a,b)=>a+b)).toFixed(2) + 'x');
    }
}

run().catch(e => { console.error(e); process.exit(1); });
