# [Bug] 调试器断点无法真实取消，调用栈路径不匹配

## 描述

调试器存在三个相关问题：
1. 取消断点时，GDB 端断点未被删除，仅前端 UI 移除装饰物
2. 调用栈中的文件路径为相对路径，点击无法跳转到编辑器对应位置
3. 断点路径匹配使用严格相等，可能导致取消断点时找不到目标

## 重现步骤

### 断点取消问题
1. 打开一个 C++ 源文件
2. 在编辑器 gutter 点击设置断点
3. 启动调试，命中断点
4. 再次点击 gutter 取消断点
5. 继续运行，程序仍会在该断点处停下

### 调用栈路径问题
1. 启动调试并命中断点
2. 查看侧边栏调用栈面板
3. 点击调用栈中的某一行
4. 无法跳转到对应源码位置

## 预期行为

1. 取消断点后，GDB 端断点应被删除，程序不再在该处停下
2. 调用栈中的路径应为绝对路径，点击可跳转到编辑器对应位置

## 实际行为

1. 取消断点后，程序仍会在该处停下
2. 调用栈显示相对路径（如 `./src/main.cpp`），点击无响应

## 附加上下文

### 根因分析

**Bug 1: `getBreakpoints()` 方法不存在**

`main.js:10648` 调用 `gdbDebugger.getBreakpoints()`，但 `GDBDebugger` 类没有定义该方法：

```javascript
// main.js:10648
const gdbBreakpoints = gdbDebugger.getBreakpoints();  // 方法不存在

// gdb-debugger.js:36
this._breakpoints = [];  // 只有私有数组，没有 getter
```

`removeBreakpoint()` 函数的 try 块在第 10648 行处总是抛出 TypeError，被 catch 捕获。GDB 端断点永远不会被删除。

**Bug 2: `_normalizePath()` 在 Linux 上不做规范化**

```javascript
// gdb-debugger.js:509-512
_normalizePath(p) {
    if (!p) return p || '';
    if (os.platform() === 'win32') { /* Windows 有完整处理 */ }
    return p;  // Linux 直接返回，不做 path.resolve()
}
```

GDB 返回相对路径（如 `./src/main.cpp`），而编辑器使用绝对路径，导致调用栈点击无法跳转。

**Bug 3: 断点路径匹配不一致**

```javascript
// gdb-debugger.js:227 - 存储时规范化
file: this._normalizePath(file)

// main.js:10652 - 比较时用原始路径
if (bp.file === breakpoint.file && bp.line === breakpoint.line)
```

存储的路径和比较的路径不一致，可能导致匹配失败。

### 调用链分析

**断点取消流程**

1. 用户点击编辑器 gutter → `monaco-editor-manager.js:3826`
2. `sendIPC('debug-remove-breakpoint', { file, line })`
3. `main.js:3651` IPC handler → `removeBreakpoint(breakpoint)`
4. `main.js:10648` `gdbDebugger.getBreakpoints()` → TypeError
5. catch 捕获异常，仅从本地 Map 删除断点
6. GDB 端断点未删除

**调用栈获取流程**

1. GDB 触发 `stopped` 事件 → `main.js:10292`
2. `queueDebuggerRefresh()` → `getDebugCallStack()`
3. `gdb-debugger.js:289` `updateCallStack()` 发送 `bt 30`
4. `gdb-utils.js:509` `tokenizeBacktrace()` 解析输出
5. `gdb-debugger.js:294` 调用 `this._normalizePath(f.file)` → Linux 上直接返回
6. 存储相对路径，前端显示相对路径

### 修复建议

**Bug 1**: 在 `gdb-debugger.js` 添加方法：
```javascript
getBreakpoints() { return this._breakpoints; }
```

**Bug 2**: 在 `gdb-debugger.js` 修改 `_normalizePath()`：
```javascript
_normalizePath(p) {
    if (!p) return p || '';
    if (os.platform() === 'win32') {
        try { const r = fs.realpathSync.native ? fs.realpathSync.native(p) : fs.realpathSync(p); if (r) return r; } catch (_) { }
        return path.normalize(p);
    }
    // Linux/macOS 也做规范化
    try { return path.resolve(p); } catch (_) { return p; }
}
```

**Bug 3**: 在 `main.js:10652` 使用规范化路径比较：
```javascript
if (gdbDebugger._normalizePath(bp.file) === gdbDebugger._normalizePath(breakpoint.file) && bp.line === breakpoint.line)
```

## 最早提交

根据 git 历史，`getBreakpoints()` 缺失问题自调试器重构起即存在。

```bash
git log --oneline --all | grep "重构了调试器"
# 09eac7e 重构了调试器
# fe4ace7 重构了调试器
```

## 环境

- 操作系统：全平台（Linux/macOS 调用栈路径问题更明显）
- 软件版本：v1.5.4
