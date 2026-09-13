const fs = require('fs');

class OldLogger {
    constructor(file) { this.file = file; }
    write(line) { fs.appendFileSync(this.file, line, 'utf8'); }
}

class NewLogger {
    constructor(file) { this.file = file; this.buffer = []; this.scheduled = false; this.batchSize = 200; }
    write(line) {
        this.buffer.push(line);
        if (this.buffer.length >= this.batchSize) this.flush();
        else this.schedule();
    }
    schedule() {
        if (this.scheduled) return;
        this.scheduled = true;
        setImmediate(() => { this.scheduled = false; this.flush(); });
    }
    flush() {
        if (!this.buffer.length) return;
        const lines = this.buffer; this.buffer = [];
        fs.appendFileSync(this.file, lines.join(''), 'utf8');
    }
}

async function main() {
    const count = 9000;
    const line = '[2026-09-10 12:00:00.000+08:00] [INFO] [run-program] {"exec":"/tmp/test","timeLimitMs":1000,"inputBytes":1024}\n';

    const f1 = '/tmp/_old_' + process.pid + '.log';
    const oldLogger = new OldLogger(f1);
    let t0 = process.hrtime.bigint();
    for (let i = 0; i < count; i++) oldLogger.write(line);
    const oldMs = Number(process.hrtime.bigint() - t0) / 1e6;
    fs.unlinkSync(f1);

    const f2 = '/tmp/_new_' + process.pid + '.log';
    const newLogger = new NewLogger(f2);
    t0 = process.hrtime.bigint();
    for (let i = 0; i < count; i++) newLogger.write(line);
    await new Promise(r => setImmediate(() => setImmediate(r)));
    const newMs = Number(process.hrtime.bigint() - t0) / 1e6;
    fs.unlinkSync(f2);

    console.log('count =', count);
    console.log('old sync per-line  :', oldMs.toFixed(1), 'ms');
    console.log('new async batched  :', newMs.toFixed(1), 'ms');
    console.log('speedup            :', (oldMs / newMs).toFixed(1), 'x');
}

main();
