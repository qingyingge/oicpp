# 历史基准测试记录 (手动补录)

> 说明：bench-logged.js 自 2026-09-12 起自动记录 JSONL 日志。
> 此文件补录此前手工运行的结果。TPS = tests/sec，50 组测试 (fast-IO 程序) 除非另注。
> 硬件：ARM64 Linux 8 核，Node v22.22.3，Electron v37.2.0。

## 按日期倒序

### 2026-09-12 (V6 原生引擎验证)

| 时间 | 引擎 | 线程 | 场景 | 结果 | 耗时 | TPS | 备注 |
|------|------|------|------|------|------|-----|------|
| 22:45 | V6 | 8 | Sort | 50/50 | 2882ms | **17.4** | 自动日志 run-2026-09-12T22-45-48.jsonl |
| 22:45 | V6 | 8 | Graph | 50/50 | 2115ms | **23.6** | gen=62.5 std=92.5 test=87.4ms |
| 22:45 | V6 | 8 | Range | 50/50 | 6872ms | **7.3** | gen=187 std=361 test=353ms, 输出5.3MB |
| 22:43 | V6 | 4 | Sort | 10/10 | 1619ms | 6.2 | --quick, genLen=1968923B |
| ~22:3x | V6 | 8 | Sort | 50/50 | 3098ms | 16.1 | Electron IPC 全栈 |
| ~22:3x | V6 | 8 | Graph | 50/50 | 2620ms | 19.1 | Electron IPC 全栈 |
| ~22:3x | V6 | 8 | Range | 50/50 | 6094ms | 8.2 | Electron IPC 全栈 |
| ~21:5x | V6 | 4 | Sort | 50/50 | 3408ms | 14.7 | Node 直接 |
| ~21:5x | V6 | 6 | Sort | 50/50 | 3082ms | 16.2 | Node 直接 |
| ~21:5x | V6 | 8 | Sort | 50/50 | 2988ms | 16.7 | Node 直接 |
| ~21:5x | V6 | 4 | Graph | 50/50 | 2332ms | 21.4 | Node 直接 |
| ~21:5x | V6 | 6 | Graph | 50/50 | 1995ms | **25.1** | Node 直接, 达 8 核理论上限 |
| ~21:5x | V6 | 8 | Graph | 50/50 | 2002ms | 25.0 | Node 直接 |
| ~21:5x | V6 | 4 | Range | 50/50 | 7760ms | 6.4 | Node 直接 |
| ~21:5x | V6 | 6 | Range | 50/50 | 7354ms | 6.8 | Node 直接 |
| ~21:5x | V6 | 8 | Range | 50/50 | 7070ms | 7.1 | Node 直接 |

### 2026-09-12 (V3 预启动管线, 正确 harness)

| 时间 | 线程 | 场景 | 结果 | TPS | 备注 |
|------|------|------|------|-----|------|
| 21:5x | 3 | Sort | 100/100 | 10.5 | 独立 worker 分片 |
| 21:5x | 4 | Sort | 100/100 | 8.8 | |
| 21:5x | 3 | Graph | 100/100 | 11.3 | |
| 21:5x | 4 | Graph | 100/100 | 12.4 | |
| 21:5x | 3 | Range | 100/100 | 5.3 | |
| 21:5x | 4 | Range | 100/100 | 5.0 | |

### 2026-09-11 (V2 Worker Threads, 旧 scanf/printf 程序)

| 线程 | 场景 | TPS | 备注 |
|------|------|-----|------|
| 2 | Sort | 4.9 | |
| 4 | Sort | 5.6 | 峰值 |
| 8 | Sort | 5.6 | 8线程无提升 |
| 4 | Graph | 9.9 | |
| 4 | Range | 3.3 | |

### 2026-09-11 (原始 vs 优化, 50组)

| 引擎 | 场景 | TPS | 备注 |
|------|------|-----|------|
| runProgram IPC | Sort | 2.6 | 19360ms |
| runProgram IPC | Graph | 6.4 | 7868ms |
| runProgram IPC | Range | 2.0 | 25303ms |
| V1 主进程 | Sort | 2.7 | |
| V1 主进程 | Graph | 4.4 | |
| V1 主进程 | Range | 1.3 | |

### 2026-09-11 (fast-IO 程序改造, 单程序耗时)

| 程序 | 旧 scanf/printf | fast-IO | 加速 |
|------|----------------|---------|------|
| gen_sort | 144ms | 77ms | 1.9x |
| sort_std | 308ms | 117ms | 2.6x |
| sort_mergesort | 308ms | 138ms | 2.2x |

### 2026-09-11 (Logger 优化)

| 行数 | 同步逐条 | 批量异步 | 加速 |
|------|---------|---------|------|
| 9000 | 4575ms | 45ms | 101x |

## 失败的尝试 (记录在案)

| 方案 | 结果 | 根因 |
|------|------|------|
| V4 流式 tee | 5.5 TPS | 程序批量读输入, 流式无收益 |
| V5 全管线预启动 | 4.6 TPS | 3路 fork 竞争加剧 |
| V6 单worker多分片 | 假失败 | harness 首个 done 即终止 |
| V8 原生spawn+异步fd | EBADF 崩溃 | fd 进程级全局, 跨线程竞态 |

### 2026-09-13 (V10 runPair 原生双线程并行 std+test, 8线程, 50测试)

| 时间 | 引擎 | 场景 | 结果 | 耗时 | TPS | 备注 |
|------|------|------|------|------|-----|------|
| 09:34 | V10 | Sort | 50/50 | 2517ms | **19.9** | gen=120 std=test=183ms |
| 09:34 | V10 | Graph | 50/50 | 2014ms | **24.8** | gen=92 std=test=141ms |
| 09:34 | V10 | Range | 50/50 | 5995ms | **8.3** | gen=228 std=test=548ms |
| 09:34 | V10 Electron | Sort | 50/50 | 3116ms | 16.0 | Electron 全栈 IPC |
| 09:34 | V10 Electron | Graph | 50/50 | 2131ms | 23.5 | |
| 09:34 | V10 Electron | Range | 50/50 | 5607ms | 8.9 | |

线程扫描: 6线程 16.3/24.4/8.1, 10线程 18.2/21.1/8.0, 12线程 14.9/18.9/7.9 → **8线程仍最优**

与 V6 对比: Sort 17.4→19.9 (+14%), Graph 23.6→24.8 (+5%), Range 7.3→8.3 (+14%)

### Electron headless 启动方案 (2026-09-13 修复记录)

```bash
DISPLAY=:99 setsid /tmp/oicpp/node_modules/electron/dist/electron \
  --no-sandbox --ozone-platform=headless --remote-debugging-port=9223 \
  --use-vulkan=swiftshader --use-angle=swiftshader \
  --enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan \
  --no-zygote --disable-dev-shm-usage --disable-gpu-sandbox /tmp/oicpp
```

- 根因: proot 无 GPU, ANGLE/SwANGLE 后端 EGL 初始化失败 → GPU 进程崩溃 → 渲染进程死亡 → CDP 无响应
- 突破: 强制 Vulkan SwiftShader 软件渲染路径, GPU 进程虽崩(exit 11)但渲染进程存活
- 坑: pkill -f 模式若匹配自身命令行会自杀; 用字符类 'electro[n]' 规避

### 2026-09-13 干净环境重测（无 Electron/opencode 干扰, 8线程, 50测试, 3轮中位数）

| 场景 | V10 旧环境(有Electron) | **干净环境基线** | stagger60 | CPU 上限(实测程序) |
|------|------------------------|------------------|-----------|-------------------|
| Sort | 19.9 | **23.3 TPS** | 24.0 (+3%) | ~23 |
| Graph | 24.8 | **33.1 TPS** | 33.1 (0%) | ~33 |
| Range | 8.3 | **10.1 TPS** | 10.2 (+1%) | ~10 |

**重要发现**: 此前所有基准数据均受 Electron 进程 + opencode 会话抢 CPU 干扰（Graph 被低估 33%）！
干净环境: **Sort/Graph 已达 CPU 理论极限，Range 超旧理论模型**（std+test 并行实测 10.1 TPS）。
stagger 60 错峰启动仅有噪声级正向（Sort +3%），非突破。CPU governor 不可写（权限），频率恒 1697MHz 无降频。
**结论: V10 (8线程 + runPair) + 干净环境 = 已到架构与硬件极限。**

### 2026-09-13 原版干净环境重测 (bench-original.js, 串行 runProgram 等价模拟)

| 场景 | 旧记录(有Electron干扰) | 干净环境实测 | 偏差 |
|------|------------------------|-------------|------|
| Sort | 2.6 / 1.3 TPS | **4.3 TPS** | 低估 ~65% |
| Graph | 6.4 / 3.3 TPS | **6.4 TPS** | 6.4 那条本来就准 |
| Range | 2.0 / 1.0 TPS | **2.4 TPS** | 低估 ~20% |

**修正后的真实总加速比 (原版 → V10, 干净环境):**

| 场景 | 原版 | V10 | 真实加速 | (此前声称) |
|------|------|-----|---------|-----------|
| Sort | 4.3 | 23.3 | **5.4x** | 12.4x (夸大) |
| Graph | 6.4 | 33.1 | **5.2x** | 5.8x |
| Range | 2.4 | 10.1 | **4.2x** | 8.2x (夸大) |

**教训**: 所有基准必须固定环境负载; 此前的加速比用被低估的旧引擎做分母, 系统性夸大。V10 真实收益为 4.2-5.4x, 仍远超 V3(约3x)。
