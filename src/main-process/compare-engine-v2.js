/**
 * CompareEngineV2 — Worker Thread 多线程对拍引擎
 * 每个 Worker Thread 有独立事件循环 + 独立 spawn
 * 消除单事件循环瓶颈，实现真并行
 */
const { EventEmitter } = require('events');
const { Worker } = require('worker_threads');
const path = require('path');
const os = require('os');

class CompareEngineV2 extends EventEmitter {
    constructor() {
        super();
        this._state = 'idle';
        this._workers = [];
        this._completed = 0;
        this._total = 0;
        this._errors = 0;
        this._stopRequested = false;
    }

    get state() { return this._state; }

    async start(config) {
        if (this._state === 'running') throw new Error('Engine already running');
        this._state = 'running';
        this._stopRequested = false;
        this._completed = 0;
        this._total = config.totalTests;
        this._errors = 0;

        try {
            const threadCount = Math.min(config.threadCount || os.cpus().length, config.totalTests);
            const perThread = Math.ceil(config.totalTests / threadCount);
            const workerPath = path.join(__dirname, 'compare-worker-v6.js');

            const resolvePath = (exe) => {
                if (!exe) return '';
                if (typeof exe === 'string') return exe;
                return exe.executablePath || exe.path || '';
            };
            const genPath = resolvePath(config.generator);
            const stdPath = resolvePath(config.stdExe);
            const testPath = resolvePath(config.testExe);

            if (!genPath || !stdPath || !testPath) {
                throw new Error('Missing executable paths: gen=' + genPath + ' std=' + stdPath + ' test=' + testPath);
            }

            const donePromises = [];

            for (let t = 0; t < threadCount; t++) {
                const startIdx = t * perThread + 1;
                const count = Math.min(perThread, config.totalTests - startIdx + 1);
                if (count <= 0) continue;

                const worker = new Worker(workerPath);
                this._workers.push(worker);

                const donePromise = new Promise((resolve) => {
                    const handler = (msg) => {
                        if (msg.type === 'progress') {
                            this._completed++;
                            this.emit('progress', { current: this._completed, total: this._total, testIndex: msg.testIndex });
                        } else if (msg.type === 'error') {
                            this._errors++;
                            this.emit('error', {
                                testNumber: msg.testIndex, type: msg.kind, message: msg.message,
                                stdOutput: msg.stdOutput || '', testOutput: msg.testOutput || ''
                            });
                        } else if (msg.type === 'done') {
                            worker.removeListener('message', handler);
                            resolve();
                        }
                    };
                    worker.on('message', handler);
                    worker.on('error', (err) => {
                        this._errors++;
                        this.emit('error', { testNumber: 0, type: 'worker_crash', message: err.message });
                        worker.removeListener('message', handler);
                        resolve();
                    });
                });

                donePromises.push(donePromise);
                worker.postMessage({
                    type: 'run-tests',
                    startIdx, count,
                    genPath, stdPath, testPath,
                    timeout: config.timeLimit || 5000
                });
            }

            await Promise.all(donePromises);

            if (this._state === 'stopping') {
                this.emit('stopped', { completed: this._completed });
            } else {
                this.emit('complete', {
                    total: this._total, completed: this._completed, failed: this._errors,
                    warning: this._errors > 0 ? this._errors + ' tests failed' : null
                });
            }
        } catch (error) {
            this.emit('error', { testNumber: 0, type: 'engine', message: error.message });
        } finally {
            this._workers.forEach(w => { try { w.terminate(); } catch(_) {} });
            this._workers = [];
            this._state = 'idle';
        }
    }

    async stop() {
        this._stopRequested = true;
        this._state = 'stopping';
        this._workers.forEach(w => { try { w.postMessage({ type: 'stop' }); } catch(_) {} });
    }
}

module.exports = { CompareEngineV2 };
