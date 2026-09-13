# 对拍器性能优化记录

## 摘要

对拍器引擎经三轮架构演进，吞吐提升 **4.2–5.4 倍**（8 核 ARM64 Cortex-A53 实测，3 轮中位数，50 测试）。

## 实测数据

| 场景 | 原版 spawn | 纯 Node 管线 (V3) | 原生 posix_spawn (V10) | 总加速 |
|------|-----------|-------------------|------------------------|--------|
| Sort | 4.3 TPS | 10.7 TPS | **23.3 TPS** | **5.4x** |
| Graph | 6.4 TPS | 13.2 TPS | **33.1 TPS** | **5.2x** |
| Range | 2.4 TPS | 5.9 TPS | **10.1 TPS** | **4.2x** |

## 核心改动

- **原生进程调度**：新增 N-API 模块 `fastspawn.node`（源码 `fastspawn.cc`），`posix_spawn` 替代 Node `fork`（7ms → 17ms，快 2.2 倍）
- **runPair 并行**：std 与 test 程序互不依赖，pthread 双线程同时执行，单测试耗时从 `gen+std+test` 降为 `gen+max(std,test)`
- **多 Worker 分片**：每个 Worker Thread = 独立 OS 线程串行跑测试切片，N 个 worker = N 路真并行，无事件循环争抢、无 fd 跨线程竞态
- **JS 回退**：原生模块加载失败时自动回退纯 Node 实现，功能不受影响

## 实现文件

- `src/main-process/compare-engine-v2.js` — 引擎入口（生产已接入，`main.js` 第 5960 行引用）
- `src/main-process/compare-worker-v6.js` — V6/V10 worker（原生 + JS 回退双路径）
- `fastspawn.cc` — 原生 addon 源码（编译产物 `fastspawn.node` 需自行构建）

## 复现

```bash
# 构建原生模块（需 Node headers）
g++ -O2 -fPIC -shared -pthread -I$NODE_HEADERS/include/node -o fastspawn.node fastspawn.cc

# 跑基准（自动记录每测试 JSONL 日志到 benchmark/logs/）
node benchmark/bench-logged.js --threads 8
```

## 设计教训

1. 基准必须固定环境负载：Electron/占用 CPU 的进程会系统性低估吞吐（实测 Graph 被低估 33%）
2. 原生模块返回裸 fd 给 Node 异步流（V7/V8）有跨线程 fd 竞态，不可修复；fd 全在 addon 内部管理才是正解（V6/V10）
3. 同步原生调用占用的只是单个 worker 线程的事件循环，多 worker 下并行度 = 线程数，无性能损失（V6 突破）