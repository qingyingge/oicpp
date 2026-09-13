# OICPP Compare Benchmark

测试对拍器 std/test 管线在不同算法场景下的串行 vs 并行性能差异。

## 场景

| 场景 | 算法A | 算法B | 数据规模 |
|------|-------|-------|----------|
| Sort | std::sort | 手写归并排序 | n=200K |
| Graph | Dijkstra (堆优化) | SPFA | n=10K, m=50K |
| Range | 树状数组 | 线段树 | n=200K, q=200K |

所有场景均为**不同算法产出相同结果**，符合真实 OI 对拍用例。

## 使用

```bash
node bench.js           # 完整测试 (~5分钟)
node bench.js --quick   # 快速测试 (~1分钟)
```

需要 `g++` 在 PATH 中（或设置 `CXX` 环境变量）。

## 输出示例

```
Pipeline latency: serial vs parallel (15 iters)

Scenario                  Serial    Parallel   Speedup
--------------------------------------------------------------
Sort: std vs mergesort       816ms     486ms   1.68x
Graph: Dijkstra vs SPFA      456ms     282ms   1.62x
Range: BIT vs SegTree       1965ms    1233ms   1.59x
--------------------------------------------------------------
Average                     1079ms     667ms   1.62x

Logger bottleneck: sync per-line vs batched
9000 lines: sync=4575ms  batch=45ms  101.7x
```
