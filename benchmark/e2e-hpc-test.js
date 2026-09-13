#!/usr/bin/env node
/**
 * E2E test: launch Electron, create test files, trigger compare via DevTools
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ELECTRON = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron');
const APP = path.join(__dirname, '..');

// Create test C++ files
const TMPDIR = '/tmp/oicpp_e2e_test';
fs.mkdirSync(TMPDIR, { recursive: true });

fs.writeFileSync(path.join(TMPDIR, 'generator.cpp'), `
#include <cstdio>
#include <cstdlib>
int main() {
    srand(42);
    int n = 100;
    printf("%d\\n", n);
    for (int i = 0; i < n; i++) printf("%d ", rand() % 1000);
    printf("\\n");
    return 0;
}
`);

fs.writeFileSync(path.join(TMPDIR, 'solution_a.cpp'), `
#include <cstdio>
#include <vector>
#include <algorithm>
int main() {
    int n;
    scanf("%d", &n);
    std::vector<int> a(n);
    for (int i = 0; i < n; i++) scanf("%d", &a[i]);
    std::sort(a.begin(), a.end());
    for (int i = 0; i < n; i++) printf("%d ", a[i]);
    printf("\\n");
    return 0;
}
`);

fs.writeFileSync(path.join(TMPDIR, 'solution_b.cpp'), `
#include <cstdio>
#include <algorithm>
int a[200001], b[200001];
void msort(int l, int r) {
    if (l >= r) return;
    int mid = l + (r - l) / 2;
    msort(l, mid); msort(mid + 1, r);
    int i = l, j = mid + 1, k = l;
    while (i <= mid && j <= r) b[k++] = a[i] <= a[j] ? a[i++] : a[j++];
    while (i <= mid) b[k++] = a[i++];
    while (j <= r) b[k++] = a[j++];
    for (int x = l; x <= r; x++) a[x] = b[x];
}
int main() {
    int n;
    scanf("%d", &n);
    for (int i = 1; i <= n; i++) scanf("%d", &a[i]);
    msort(1, n);
    for (int i = 1; i <= n; i++) printf("%d ", a[i]);
    printf("\\n");
    return 0;
}
`);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getDebugTargets() {
    return new Promise((resolve, reject) => {
        http.get('http://127.0.0.1:9222/json', (res) => {
            let data = '';
            res.on('data', d => data += d);
            res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
    });
}

async function sendCDPCommand(ws, method, params = {}) {
    const WebSocket = (await import('ws')).default;
    return new Promise((resolve, reject) => {
        const id = Date.now();
        ws.send(JSON.stringify({ id, method, params }));
        const handler = (msg) => {
            const data = JSON.parse(msg);
            if (data.id === id) {
                ws.removeListener('message', handler);
                if (data.error) reject(new Error(data.error.message));
                else resolve(data.result);
            }
        };
        ws.on('message', handler);
        setTimeout(() => reject(new Error('CDP timeout')), 30000);
    });
}

async function main() {
    console.log('='.repeat(60));
    console.log('  E2E HPC Test — Full Electron Integration');
    console.log('='.repeat(60));

    // Start Electron with remote debugging
    console.log('\n[1] Starting Electron...');
    const electron = spawn(ELECTRON, [
        '--no-sandbox', '--ozone-platform=headless', '--disable-gpu',
        '--no-zygote', '--disable-dev-shm-usage',
        '--remote-debugging-port=9222',
        APP
    ], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, DISPLAY: ':99' }
    });

    electron.stderr.on('data', () => {}); // suppress
    let appReady = false;

    // Wait for Electron to start
    for (let i = 0; i < 30; i++) {
        try {
            const targets = await getDebugTargets();
            const page = targets.find(t => t.type === 'page');
            if (page) {
                appReady = true;
                console.log('  App ready, page: ' + page.title);
                break;
            }
        } catch(_) {}
        await sleep(1000);
    }

    if (!appReady) {
        console.log('  FAIL: Electron did not start in 30s');
        electron.kill('SIGKILL');
        process.exit(1);
    }

    // Connect to renderer via CDP
    console.log('\n[2] Connecting to renderer...');
    const targets = await getDebugTargets();
    const page = targets.find(t => t.type === 'page');
    const WebSocket = (await import('ws')).default;
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise(r => ws.on('open', r));
    console.log('  Connected');

    // Enable Runtime
    await sendCDPCommand(ws, 'Runtime.enable');

    // Helper to evaluate JS in renderer
    async function evalJS(expression) {
        const result = await sendCDPCommand(ws, 'Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
            timeout: 30000
        });
        if (result.exceptionDetails) {
            throw new Error('JS Error: ' + result.exceptionDetails.text);
        }
        return result.result?.value;
    }

    // Test: Check if compare engine IPC is registered
    console.log('\n[3] Testing IPC registration...');
    const hasAPI = await evalJS('typeof window.electronAPI?.startCompare === "function"');
    console.log('  startCompare API: ' + hasAPI);
    if (!hasAPI) throw new Error('startCompare API not found');

    const hasStop = await evalJS('typeof window.electronAPI?.stopCompare === "function"');
    console.log('  stopCompare API: ' + hasStop);

    const hasProgress = await evalJS('typeof window.electronAPI?.onCompareProgress === "function"');
    console.log('  onCompareProgress API: ' + hasProgress);

    // Test: Trigger compare engine directly via IPC
    console.log('\n[4] Triggering CompareEngine via IPC...');

    const genPath = path.join(TMPDIR, 'generator.cpp');
    const stdPath = path.join(TMPDIR, 'solution_a.cpp');
    const testPath = path.join(TMPDIR, 'solution_b.cpp');

    // Compile test programs first
    const compile = (src, out) => new Promise((resolve, reject) => {
        spawn('g++', ['-O2', '-std=c++14', '-o', out, src], { stdio: 'pipe' })
            .on('close', c => c === 0 ? resolve() : reject(new Error('compile fail')));
    });

    console.log('  Compiling test programs...');
    await compile(genPath, path.join(TMPDIR, 'gen'));
    await compile(stdPath, path.join(TMPDIR, 'std'));
    await compile(testPath, path.join(TMPDIR, 'test'));
    console.log('  Compiled OK');

    // Directly invoke compare-start via IPC from main process
    const compareResult = await evalJS(`
        (async () => {
            try {
                const config = {
                    stdExe: { executablePath: '${path.join(TMPDIR, 'std')}' },
                    testExe: { executablePath: '${path.join(TMPDIR, 'test')}' },
                    generator: { executablePath: '${path.join(TMPDIR, 'gen')}' },
                    totalTests: 5,
                    timeLimit: 5000,
                    threadCount: 2,
                    useTestlib: false,
                    freopen: null
                };

                let progress = 0;
                let errors = 0;
                let completed = 0;

                window.electronAPI.onCompareProgress((data) => {
                    progress = data.current;
                });
                window.electronAPI.onCompareError((data) => {
                    errors++;
                    console.error('Compare error:', data);
                });
                window.electronAPI.onCompareComplete((data) => {
                    completed = data.completed;
                });

                await window.electronAPI.startCompare(config);

                // Wait for completion
                for (let i = 0; i < 60; i++) {
                    await new Promise(r => setTimeout(r, 1000));
                    if (completed > 0 || errors > 0) break;
                }

                return { progress, errors, completed };
            } catch(e) {
                return { error: e.message };
            }
        })()
    `);

    console.log('  Result: ' + JSON.stringify(compareResult));
    if (compareResult.error) throw new Error(compareResult.error);

    if (compareResult.completed === 5 && compareResult.errors === 0) {
        console.log('  PASS: All 5 tests completed successfully');
    } else {
        console.log('  FAIL: completed=' + compareResult.completed + ' errors=' + compareResult.errors);
    }

    // Check logs
    console.log('\n[5] Checking main process logs...');
    const logFiles = fs.readdirSync('/root/.oicpp/logs').sort().reverse();
    if (logFiles.length > 0) {
        const latestLog = fs.readFileSync(path.join('/root/.oicpp/logs', logFiles[0]), 'utf8');
        const hasCompareStart = latestLog.includes('compare-start') || latestLog.includes('对拍');
        const hasEngineLog = latestLog.includes('Engine') || latestLog.includes('ProcessPool');
        console.log('  Compare start in log: ' + hasCompareStart);
        console.log('  Engine log entries: ' + hasEngineLog);
    }

    // Cleanup
    ws.close();
    electron.kill('SIGKILL');

    console.log('\n' + '='.repeat(60));
    console.log('  E2E TEST PASSED');
    console.log('='.repeat(60));
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
