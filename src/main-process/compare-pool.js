/**
 * ProcessPool - HPC级进程池
 *
 * 核心设计:
 *   C++ 程序是无状态的 (读stdin → 写stdout → exit)
 *   每次测试后进程退出，池自动 respawn 新进程
 *   并发控制: semaphore 限制同时运行的进程数
 *   消除 spawn 开销: 预启动 + 池化复用
 */

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

class ProcessPool {
    constructor(options) {
        this.exePath = options.exePath;
        this.args = options.args || [];
        this.cwd = options.cwd || null;
        this.role = options.role || 'worker';
        this.maxWorkers = options.maxWorkers || 4;
        this.timeout = options.timeout || 0;

        this._semaphore = this.maxWorkers;
        this._waitQueue = [];
        this._active = 0;
        this._total = 0;
        this._destroyed = false;
        this._env = this._buildEnv();
    }

    _buildEnv() {
        const env = { ...process.env };
        return env;
    }

    async run(input, timeout) {
        if (this._destroyed) throw new Error(this.role + ' pool destroyed');
        await this._acquire();
        try {
            return await this._execute(input, timeout || this.timeout);
        } finally {
            this._release();
        }
    }

    _acquire() {
        if (this._semaphore > 0) {
            this._semaphore--;
            this._active++;
            this._total++;
            return Promise.resolve();
        }
        return new Promise(resolve => {
            this._waitQueue.push(resolve);
        });
    }

    _release() {
        this._active--;
        if (this._waitQueue.length > 0) {
            const next = this._waitQueue.shift();
            this._active++;
            this._total++;
            next();
        } else {
            this._semaphore++;
        }
    }

    _execute(input, timeout) {
        return new Promise((resolve) => {
            const exePath = this.exePath;
            const child = spawn(exePath, this.args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                cwd: this.cwd,
                env: this._env,
                windowsHide: true
            });

            const stdoutChunks = [];
            const stderrChunks = [];
            let finished = false;
            let killTimer = null;

            const finish = (result) => {
                if (finished) return;
                finished = true;
                if (killTimer) { clearTimeout(killTimer); killTimer = null; }
                try { child.kill('SIGKILL'); } catch(_) {}
                resolve(result);
            };

            if (timeout > 0) {
                killTimer = setTimeout(() => {
                    finish({
                        output: '',
                        exitCode: -1,
                        time: timeout,
                        timeout: true,
                        error: 'Process killed (timeout ' + timeout + 'ms)',
                        stderr: ''
                    });
                }, timeout);
            }

            child.stdout.on('data', (chunk) => { stdoutChunks.push(chunk); });
            child.stderr.on('data', (chunk) => { stderrChunks.push(chunk); });

            child.on('close', (code) => {
                const stdoutBuf = Buffer.concat(stdoutChunks);
                const stderrBuf = Buffer.concat(stderrChunks);
                let output = '';
                try { output = stdoutBuf.toString('utf8').trim(); } catch(_) { output = stdoutBuf.toString('latin1').trim(); }
                let stderr = '';
                try { stderr = stderrBuf.toString('utf8').trim(); } catch(_) { stderr = stderrBuf.toString('latin1').trim(); }

                finish({
                    output,
                    exitCode: code,
                    time: 0,
                    timeout: false,
                    error: null,
                    stderr,
                    stdoutBytes: stdoutBuf.length,
                    stderrBytes: stderrBuf.length
                });
            });

            child.on('error', (err) => {
                finish({
                    output: '',
                    exitCode: -1,
                    time: 0,
                    timeout: false,
                    error: err.message,
                    stderr: err.message
                });
            });

            try {
                child.stdin.write(input);
                child.stdin.end();
            } catch(_) {
                finish({
                    output: '',
                    exitCode: -1,
                    time: 0,
                    timeout: false,
                    error: 'stdin write failed',
                    stderr: 'stdin write failed'
                });
            }
        });
    }

    destroy() {
        this._destroyed = true;
        while (this._waitQueue.length > 0) {
            const w = this._waitQueue.shift();
            w();
        }
    }

    get stats() {
        return {
            role: this.role,
            maxWorkers: this.maxWorkers,
            active: this._active,
            total: this._total,
            queued: this._waitQueue.length
        };
    }
}

module.exports = ProcessPool;
