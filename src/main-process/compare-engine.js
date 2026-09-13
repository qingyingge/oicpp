/**
 * CompareEngine - HPC级对拍引擎
 *
 * 主进程独立运行，renderer 只发1次IPC启动
 * 内部使用 ProcessPool 消除 spawn 开销
 * EventEmitter 驱动进度/错误/完成事件
 */

const { EventEmitter } = require('events');
const ProcessPool = require('./compare-pool');
const fs = require('fs');
const path = require('path');
const os = require('os');

const OUTPUT_LIMIT = 256 * 1024 * 1024;

class CompareEngine extends EventEmitter {
    constructor() {
        super();
        this._state = 'idle';
        this._pools = {};
        this._stopRequested = false;
        this._completed = 0;
        this._total = 0;
        this._errorOccurred = false;
    }

    get state() { return this._state; }

    async start(config) {
        if (this._state === 'running') throw new Error('Engine already running');

        this._state = 'running';
        this._stopRequested = false;
        this._completed = 0;
        this._total = config.totalTests;
        this._errorOccurred = false;

        try {
            await this._createPools(config);
            await this._runLoop(config);
        } catch (error) {
            this.emit('error', { testNumber: 0, type: 'engine', message: error.message });
        } finally {
            await this._destroyPools();
            if (this._state === 'running') {
                this._state = 'idle';
                this.emit('complete', {
                    total: this._total,
                    completed: this._completed,
                    failed: 0,
                    warning: null
                });
            }
        }
    }

    async stop() {
        this._stopRequested = true;
        this._state = 'stopping';
    }

    async _createPools(config) {
        const threadCount = config.threadCount || 4;

        const parseExe = (exe) => {
            if (!exe) return null;
            if (typeof exe === 'string') return { executablePath: exe, args: [], cwd: null };
            return { executablePath: exe.executablePath || exe.path, args: exe.args || [], cwd: exe.workingDirectory || null };
        };

        const genDef = parseExe(config.generator);
        if (genDef) {
            this._pools.gen = new ProcessPool({
                exePath: genDef.executablePath, args: genDef.args,
                cwd: genDef.cwd, role: 'gen', maxWorkers: 1
            });
        }

        const stdDef = parseExe(config.stdExe);
        if (stdDef) {
            this._pools.std = new ProcessPool({
                exePath: stdDef.executablePath, args: stdDef.args,
                cwd: stdDef.cwd, role: 'std', maxWorkers: threadCount
            });
        }

        const testDef = parseExe(config.testExe);
        if (testDef) {
            this._pools.test = new ProcessPool({
                exePath: testDef.executablePath, args: testDef.args,
                cwd: testDef.cwd, role: 'test', maxWorkers: threadCount
            });
        }

        if (config.spjExe) {
            const spjDef = parseExe(config.spjExe);
            if (spjDef) {
                this._pools.spj = new ProcessPool({
                    exePath: spjDef.executablePath, args: spjDef.args,
                    cwd: spjDef.cwd, role: 'spj', maxWorkers: 1
                });
            }
        }

        await Promise.all(Object.values(this._pools).map(p => Promise.resolve()));
    }

    async _runLoop(config) {
        const { totalTests, timeLimit, threadCount, useTestlib, freopen } = config;
        let nextIndex = 1;

        const worker = async () => {
            while (true) {
                if (this._stopRequested || this._errorOccurred) return;
                const i = nextIndex++;
                if (i > totalTests) return;

                try {
                    const result = await this._runOneTest(i, config);
                    if (!result.ok) {
                        this._errorOccurred = true;
                        this.emit('error', {
                            testNumber: i,
                            type: result.errorType,
                            input: result.input,
                            stdOutput: result.stdOutput,
                            testOutput: result.testOutput,
                            message: result.errorMessage
                        });
                        return;
                    }

                    this._completed++;
                    this.emit('progress', {
                        current: this._completed,
                        total: totalTests,
                        testIndex: i
                    });
                } catch (error) {
                    this._errorOccurred = true;
                    this.emit('error', {
                        testNumber: i,
                        type: 'exception',
                        message: error.message
                    });
                    return;
                }
            }
        };

        const workerCount = Math.min(threadCount, totalTests);
        await Promise.all(Array.from({ length: workerCount }, () => worker()));
    }

    async _runOneTest(i, config) {
        const { timeLimit, useTestlib, spjExe, freopen } = config;

        if (!this._pools.gen) {
            return { ok: false, errorType: 'config', errorMessage: 'No generator configured' };
        }

        const genResult = await this._pools.gen.run('', 10000);
        if (genResult.exitCode !== 0 || genResult.timeout) {
            return {
                ok: false, errorType: 'generator',
                input: genResult.output || '',
                stdOutput: '', testOutput: '',
                errorMessage: genResult.timeout ? 'Generator timeout (TLE)' :
                    (genResult.error || 'Generator exited with code ' + genResult.exitCode)
            };
        }
        const inputData = genResult.output;

        let stdOutput, testOutput;
        try {
            const [stdResult, testResult] = await Promise.all([
                this._runWithFreopen(this._pools.std, inputData, timeLimit, freopen, 'std', i),
                this._runWithFreopen(this._pools.test, inputData, timeLimit, freopen, 'test', i)
            ]);

            if (stdResult.timeout) {
                return { ok: false, errorType: 'std_tle', input: inputData, stdOutput: '', testOutput: '',
                    errorMessage: 'Standard program timeout (TLE)' };
            }
            if (stdResult.error) {
                return { ok: false, errorType: 'std_re', input: inputData, stdOutput: stdResult.stderr || '', testOutput: '',
                    errorMessage: 'Standard program runtime error: ' + stdResult.error };
            }
            if (stdResult.exitCode !== 0 && stdResult.exitCode !== null) {
                return { ok: false, errorType: 'std_re', input: inputData, stdOutput: stdResult.output, testOutput: '',
                    errorMessage: 'Standard program exited with code ' + stdResult.exitCode };
            }

            if (testResult.timeout) {
                return { ok: false, errorType: 'test_tle', input: inputData, stdOutput: stdResult.output, testOutput: '',
                    errorMessage: 'Test program timeout (TLE)' };
            }
            if (testResult.error) {
                return { ok: false, errorType: 'test_re', input: inputData, stdOutput: stdResult.output, testOutput: testResult.stderr || '',
                    errorMessage: 'Test program runtime error: ' + testResult.error };
            }
            if (testResult.exitCode !== 0 && testResult.exitCode !== null) {
                return { ok: false, errorType: 'test_re', input: inputData, stdOutput: stdResult.output, testOutput: testResult.output,
                    errorMessage: 'Test program exited with code ' + testResult.exitCode };
            }

            stdOutput = stdResult.output;
            testOutput = testResult.output;
        } catch (error) {
            return { ok: false, errorType: 'exception', input: inputData, stdOutput: '', testOutput: '',
                errorMessage: error.message };
        }

        if (useTestlib && this._pools.spj) {
            const spjOk = await this._runSpj(spjExe, inputData, stdOutput, testOutput, timeLimit);
            if (!spjOk) {
                return { ok: false, errorType: 'spj', input: inputData, stdOutput, testOutput,
                    errorMessage: 'SPJ verdict: not AC' };
            }
        } else {
            if (!this._compareOutputs(stdOutput, testOutput)) {
                return { ok: false, errorType: 'mismatch', input: inputData, stdOutput, testOutput,
                    errorMessage: 'Output mismatch' };
            }
        }

        return { ok: true };
    }

    async _runWithFreopen(pool, inputData, timeLimit, freopen, role, caseIndex) {
        if (!freopen || (!freopen.inputFile && !freopen.outputFile)) {
            return await pool.run(inputData, timeLimit);
        }

        const tmpDir = path.join(os.tmpdir(), 'oicpp_compare', role + '_' + caseIndex);
        try {
            fs.mkdirSync(tmpDir, { recursive: true });

            if (freopen.inputFile) {
                fs.writeFileSync(path.join(tmpDir, freopen.inputFile), inputData, 'utf8');
            }

            const result = await pool.run('', timeLimit);

            if (freopen.outputFile) {
                const outPath = path.join(tmpDir, freopen.outputFile);
                if (fs.existsSync(outPath)) {
                    result.output = fs.readFileSync(outPath, 'utf8').trim();
                }
            }

            return result;
        } finally {
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch(_) {}
        }
    }

    async _runSpj(spjExe, inputData, stdOutput, testOutput, timeLimit) {
        const tmpDir = path.join(os.tmpdir(), 'oicpp_spj_' + process.pid + '_' + Date.now());
        try {
            fs.mkdirSync(tmpDir, { recursive: true });
            fs.writeFileSync(path.join(tmpDir, 'input.txt'), inputData, 'utf8');
            fs.writeFileSync(path.join(tmpDir, 'answer.txt'), stdOutput, 'utf8');
            fs.writeFileSync(path.join(tmpDir, 'output.txt'), testOutput, 'utf8');

            const result = await this._pools.spj.run('', timeLimit || 5000);
            return result.exitCode === 0;
        } finally {
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch(_) {}
        }
    }

    _compareOutputs(a, b) {
        const norm = (s) => (s || '').split('\n').map(l => l.trimEnd()).join('\n').replace(/\n+$/, '');
        return norm(a) === norm(b);
    }

    async _destroyPools() {
        for (const pool of Object.values(this._pools)) {
            pool.destroy();
        }
        this._pools = {};
    }
}

module.exports = { CompareEngine };
