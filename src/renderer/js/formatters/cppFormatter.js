"use strict";
function getDefaultCppFormatterClangFormatStyle() {
    return {
        BasedOnStyle: 'LLVM',
        IndentWidth: 4,
        TabWidth: 4,
        UseTab: 'Never',
        ColumnLimit: 0,
        BreakBeforeBraces: 'Attach',
        AllowShortIfStatementsOnASingleLine: 'Never',
        AllowShortFunctionsOnASingleLine: 'Empty',
        IndentCaseLabels: false,
        PointerAlignment: 'Left',
        SpaceBeforeParens: 'ControlStatements',
        SortIncludes: true,
        AlignConsecutiveAssignments: false,
        AlignConsecutiveDeclarations: false
    };
}
function normalizeCppFormatterClangFormatStyle(raw) {
    const defaults = getDefaultCppFormatterClangFormatStyle();
    const normalized = { ...defaults };
    if (!raw || typeof raw !== 'object') {
        return normalized;
    }
    const rawRecord = raw;
    const toInt = (value, fallback) => {
        const parsed = parseInt(String(value), 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    };
    const toBool = (value, fallback) => {
        if (typeof value === 'boolean')
            return value;
        if (typeof value === 'string') {
            const lowered = value.trim().toLowerCase();
            if (['true', 'yes', 'on'].includes(lowered))
                return true;
            if (['false', 'no', 'off'].includes(lowered))
                return false;
        }
        return fallback;
    };
    const toEnum = (value, allowed, fallback) => {
        const rawValue = String(value || '').trim();
        if (!rawValue)
            return fallback;
        const matched = allowed.find((item) => item.toLowerCase() === rawValue.toLowerCase());
        return matched || fallback;
    };
    normalized.BasedOnStyle = toEnum(rawRecord.BasedOnStyle, ['LLVM', 'Google', 'Mozilla', 'Chromium', 'Microsoft', 'WebKit'], defaults.BasedOnStyle);
    normalized.IndentWidth = toInt(rawRecord.IndentWidth, defaults.IndentWidth);
    normalized.TabWidth = toInt(rawRecord.TabWidth, normalized.IndentWidth);
    normalized.UseTab = toEnum(rawRecord.UseTab, ['Never', 'ForIndentation', 'ForContinuationAndIndentation', 'Always'], defaults.UseTab);
    normalized.ColumnLimit = toInt(rawRecord.ColumnLimit, defaults.ColumnLimit);
    normalized.BreakBeforeBraces = toEnum(rawRecord.BreakBeforeBraces, ['Attach', 'LLVM', 'Stroustrup', 'Allman', 'GNU', 'Mozilla', 'WebKit', 'Custom'], defaults.BreakBeforeBraces);
    normalized.AllowShortIfStatementsOnASingleLine = toEnum(rawRecord.AllowShortIfStatementsOnASingleLine, ['Never', 'WithoutElse', 'OnlyFirstIf', 'AllIfsAndElse', 'Always'], defaults.AllowShortIfStatementsOnASingleLine);
    normalized.AllowShortFunctionsOnASingleLine = toEnum(rawRecord.AllowShortFunctionsOnASingleLine, ['None', 'Empty', 'Inline', 'All'], defaults.AllowShortFunctionsOnASingleLine);
    normalized.IndentCaseLabels = toBool(rawRecord.IndentCaseLabels, defaults.IndentCaseLabels);
    normalized.PointerAlignment = toEnum(rawRecord.PointerAlignment, ['Left', 'Right', 'Middle'], defaults.PointerAlignment);
    normalized.SpaceBeforeParens = toEnum(rawRecord.SpaceBeforeParens, ['Never', 'ControlStatements', 'Always', 'Custom'], defaults.SpaceBeforeParens);
    normalized.SortIncludes = toBool(rawRecord.SortIncludes, defaults.SortIncludes);
    normalized.AlignConsecutiveAssignments = toBool(rawRecord.AlignConsecutiveAssignments, defaults.AlignConsecutiveAssignments);
    normalized.AlignConsecutiveDeclarations = toBool(rawRecord.AlignConsecutiveDeclarations, defaults.AlignConsecutiveDeclarations);
    if (Object.prototype.hasOwnProperty.call(rawRecord, 'formatterIndentStyle') && !Object.prototype.hasOwnProperty.call(rawRecord, 'UseTab')) {
        const legacyStyle = String(rawRecord.formatterIndentStyle || '').trim().toLowerCase();
        if (legacyStyle === 'tabs') {
            normalized.UseTab = 'Always';
        }
        else if (legacyStyle === 'spaces') {
            normalized.UseTab = 'Never';
        }
    }
    return normalized;
}
function formatCpp(code, options = {}) {
    if (!code || typeof code !== 'string')
        return String(code || '');
    const clangFormatStyle = normalizeCppFormatterClangFormatStyle(options.clangFormatStyle || options.clangFormat || {});
    const indentWidth = Number.isFinite(clangFormatStyle.IndentWidth) && clangFormatStyle.IndentWidth > 0
        ? clangFormatStyle.IndentWidth
        : (Number.isFinite(options.tabSize) && options.tabSize > 0 ? options.tabSize : 4);
    const insertSpaces = clangFormatStyle.UseTab === 'Never';
    const breakBeforeBraces = String(clangFormatStyle.BreakBeforeBraces || 'Attach');
    const indentCaseLabels = clangFormatStyle.IndentCaseLabels !== false;
    const EOL = '\n';
    const src = String(code).replace(/\r\n?|\u2028|\u2029/g, '\n');
    const rawLines = src.split('\n');
    let inBlockComment = false;
    let indentLevel = 0;
    let blankCount = 0;
    let inPreprocessorContinuation = false;
    // 跨行原始字符串：遇到 R"(" 未在同一行闭合时记录结束符，后续行原样保留。
    let rawStringTerminator = null;
    const mkIndent = (level) => insertSpaces ? ' '.repeat(level * indentWidth) : '\t'.repeat(level);
    const out = [];
    function processLine(line, nextLine) {
        const trimmedLeft = line.replace(/^[\t ]+/, '');
        if (trimmedLeft.startsWith('#')) {
            const keep = line.replace(/[ \t]+$/g, '');
            return { segments: [keep], open: 0, close: 0, noIndent: true, restore: (t) => t };
        }
        let open = 0;
        let close = 0;
        let i = 0;
        let s = line;
        let outStr = '';
        const segments = [];
        let templateDepth = 0;
        let inlineBraceDepth = 0;
        let parenDepth = 0; // 括号深度，用于判定是否允许在分号处换行
        const isSpace = (ch) => ch === ' ' || ch === '\t';
        // 字符串/字符/注释等字面量原样保留：扫描时用占位符代替，行尾统一还原，
        // 避免后续的正则规范化改到字面量内部（见 issue #385）
        const literals = [];
        const pushLiteral = (text) => {
            literals.push(text);
            outStr += '\u0001' + String(literals.length - 1) + '\u0002';
        };
        const restoreLiterals = (text) => text.replace(/\u0001(\d+)\u0002/g, (_m, n) => literals[Number(n)]);
        let pendingSpace = false; // 记录遇到的空白，按需输出
        const addPendingSpace = () => {
            if (!pendingSpace)
                return;
            pendingSpace = false;
            if (!outStr || /\s$/.test(outStr))
                return;
            const prevCh = outStr.slice(-1);
            if (prevCh === '(' || prevCh === '[' || prevCh === '{')
                return;
            outStr += ' ';
        };
        const emitPendingSpaceIfNeeded = (nextCharCategory) => {
            if (!pendingSpace)
                return;
            const prev = outStr.replace(/\s+$/g, '').slice(-1);
            const noSpaceBefore = new Set([')', ']', '}', ',', ';', ':']);
            const noSpaceAfterPrev = new Set(['(', '[', '{']);
            if (prev && !noSpaceAfterPrev.has(prev) && nextCharCategory !== 'rb') {
                if (!/\s$/.test(outStr))
                    outStr += ' ';
            }
            pendingSpace = false;
        };
        while (i < s.length) {
            const ch = s[i];
            const next = i + 1 < s.length ? s[i + 1] : '';
            const three = i + 2 < s.length ? s.substring(i, i + 3) : '';
            if (inBlockComment) {
                const end = s.indexOf('*/', i);
                if (end === -1) {
                    pushLiteral(s.substring(i));
                    i = s.length;
                }
                else {
                    pushLiteral(s.substring(i, end + 2));
                    i = end + 2;
                    inBlockComment = false;
                }
                continue;
            }
            if (ch === '/' && next === '*') {
                addPendingSpace();
                const end = s.indexOf('*/', i + 2);
                if (end === -1) {
                    pushLiteral(s.substring(i));
                    inBlockComment = true;
                    i = s.length;
                }
                else {
                    pushLiteral(s.substring(i, end + 2));
                    i = end + 2;
                }
                continue;
            }
            if (ch === '/' && next === '/') {
                addPendingSpace();
                pushLiteral(s.substring(i));
                i = s.length;
                break;
            }
            if (ch === '\'') {
                addPendingSpace();
                let end = i + 1;
                while (end < s.length) {
                    if (s[end] === '\\') {
                        end += 2;
                        continue;
                    }
                    if (s[end] === '\'') {
                        end++;
                        break;
                    }
                    end++;
                }
                end = Math.min(end, s.length);
                pushLiteral(s.substring(i, end));
                i = end;
                continue;
            }
            if (ch === '"') {
                const prev = s[i - 1] || '';
                if (prev === 'R' && s[i + 1] === '(') {
                    // 原始字符串 R"delim( ... )delim" —— 内容必须完全保持原样
                    let prefixStart = i - 1;
                    if (prefixStart >= 1 && 'uUL'.includes(s[prefixStart - 1])) {
                        prefixStart--;
                        if (s[prefixStart - 1] === '8')
                            prefixStart--;
                    }
                    const prefix = s.substring(prefixStart, i);
                    if (outStr.endsWith(prefix))
                        outStr = outStr.slice(0, outStr.length - prefix.length);
                    // 当前分支已经确认前缀是 R"(，空定界符从括号前开始。
                    const delimEnd = i + 1;
                    const delimiter = s.substring(i + 1, delimEnd);
                    const terminator = ')' + delimiter + '"';
                    const closeIdx = s.indexOf(terminator, delimEnd + 1);
                    if (closeIdx === -1) {
                        rawStringTerminator = terminator;
                    }
                    const stop = closeIdx === -1 ? s.length : closeIdx + terminator.length;
                    pushLiteral(prefix + s.substring(i, stop));
                    i = stop;
                    continue;
                }
                addPendingSpace();
                let end = i + 1;
                while (end < s.length) {
                    if (s[end] === '\\') {
                        end += 2;
                        continue;
                    }
                    if (s[end] === '"') {
                        end++;
                        break;
                    }
                    end++;
                }
                end = Math.min(end, s.length);
                pushLiteral(s.substring(i, end));
                i = end;
                continue;
            }
            if (ch === '{')
                open++;
            if (ch === '}')
                close++;
            if (isSpace(ch)) {
                pendingSpace = true;
                i++;
                continue;
            }
            const two = ch + next;
            const spacedThree = ['>>=', '<<='];
            if (spacedThree.includes(three)) {
                emitPendingSpaceIfNeeded('op');
                outStr = outStr.replace(/[ ]+$/g, '');
                if (outStr && outStr[outStr.length - 1] !== ' ')
                    outStr += ' ';
                outStr += three + ' ';
                i += 3;
                continue;
            }
            if (two === '++' || two === '--') {
                emitPendingSpaceIfNeeded('op');
                const prevNonSpace = outStr.replace(/\s+$/g, '').slice(-1);
                const shouldStripSpace = /[A-Za-z0-9_\)\]\}]/.test(prevNonSpace || ''); // i++、x)++ 等去掉前空格
                if (shouldStripSpace) {
                    outStr = outStr.replace(/[ ]+$/g, '');
                }
                outStr += two;
                i += 2;
                continue;
            }
            if (two === '->' || two === '::') {
                outStr = outStr.replace(/[ ]+$/g, '');
                outStr += two;
                i += 2;
                continue;
            }
            if (two === '>>' && templateDepth > 0) {
                outStr = outStr.replace(/[ ]+$/g, '');
                outStr += '>>';
                templateDepth = Math.max(0, templateDepth - 2);
                i += 2;
                continue;
            }
            const spacedTwo = ['==', '!=', '<=', '>=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>'];
            if (spacedTwo.includes(two)) {
                emitPendingSpaceIfNeeded('op');
                outStr = outStr.replace(/[ ]+$/g, '');
                if (outStr && outStr[outStr.length - 1] !== ' ')
                    outStr += ' ';
                outStr += two + ' ';
                i += 2;
                continue;
            }
            if (ch === ',') {
                pendingSpace = false;
                outStr = outStr.replace(/[ ]+$/g, '');
                outStr += ',';
                const after = s.substring(i + 1).trimStart();
                if (after && !after.startsWith(')') && !after.startsWith(';'))
                    outStr += ' ';
                i++;
                continue;
            }
            if (ch === ';') {
                pendingSpace = false;
                outStr = outStr.replace(/[ ]+$/g, '');
                outStr += ';';
                const afterRaw = s.substring(i + 1);
                const after = afterRaw.trimStart();
                if (parenDepth === 0 && after.length > 0) {
                    segments.push(outStr);
                    outStr = '';
                    i++;
                    while (i < s.length && (s[i] === ' ' || s[i] === '\t'))
                        i++;
                    continue;
                }
                else {
                    if (after && !after.startsWith(')') && !after.startsWith('}') && !after.startsWith(';')) {
                        outStr += ' ';
                    }
                    i++;
                    continue;
                }
            }
            if (ch === '?') {
                emitPendingSpaceIfNeeded('op');
                outStr = outStr.replace(/[ ]+$/g, '');
                if (outStr && outStr[outStr.length - 1] !== ' ')
                    outStr += ' ';
                outStr += '? ';
                i++;
                continue;
            }
            if (ch === ':') {
                emitPendingSpaceIfNeeded('op');
                outStr = outStr.replace(/[ ]+$/g, '');
                if (outStr && outStr[outStr.length - 1] !== ' ')
                    outStr += ' ';
                outStr += ': ';
                i++;
                continue;
            }
            if ((ch === '-' || ch === '+') && /[0-9.]?[eE]$/.test(outStr.replace(/\s+$/g, ''))) {
                pendingSpace = false;
                outStr = outStr.replace(/[ ]+$/g, '');
                outStr += ch;
                i++;
                continue;
            }
            if ('=+-*/%<>&|^'.includes(ch)) {
                const prev = outStr.replace(/\s+$/g, '').slice(-1);
                const unary = (ch === '*' || ch === '&' || ch === '+' || ch === '-') && (!prev || '([,{;=+-*/%&|^!~?:<>'.includes(prev));
                const isTemplateStart = () => {
                    if (ch !== '<')
                        return false;
                    const prevNonSpace = outStr.replace(/\s+$/g, '').slice(-1);
                    const prevLooksLikeName = /[A-Za-z0-9_>]/.test(prevNonSpace || '');
                    if (!prevLooksLikeName)
                        return false;
                    let depth = 1;
                    let k = i + 1;
                    let content = '';
                    while (k < s.length) {
                        const c = s[k];
                        if (c === '<') {
                            depth++;
                            content += c;
                        }
                        else if (c === '>') {
                            depth--;
                            if (depth === 0)
                                break;
                            content += c;
                        }
                        else if (c === '"' || c === '\'')
                            break; // 字符串/字符开始则放弃
                        else if (/[^\sA-Za-z0-9_,:<>&*]/.test(c)) { // 出现不被允许的字符
                            return false;
                        }
                        else {
                            content += c;
                        }
                        k++;
                    }
                    if (!(k < s.length && depth === 0))
                        return false;
                    // 比较表达式（如 a < b && c > d）不能当成模板
                    if (/&&|\|\||[;{}(=+\-\/%^|!?~]/.test(content))
                        return false;
                    return true;
                };
                if (isTemplateStart()) {
                    emitPendingSpaceIfNeeded('op');
                    outStr = outStr.replace(/[ ]+$/g, '');
                    outStr += '<';
                    templateDepth++;
                    i++;
                    continue;
                }
                if (ch === '>' && templateDepth > 0) {
                    emitPendingSpaceIfNeeded('op');
                    outStr = outStr.replace(/[ ]+$/g, '');
                    outStr += '>';
                    templateDepth = Math.max(0, templateDepth - 1);
                    i++;
                    continue;
                }
                if (unary) {
                    emitPendingSpaceIfNeeded('op');
                    outStr = outStr.replace(/[ ]+$/g, '');
                    // 避免 "a / *&b" 被拼成 "a /*&b" 而变成块注释
                    if (ch === '*' && outStr.slice(-1) === '/')
                        outStr += ' ';
                    outStr += ch;
                    i++;
                    continue;
                }
                emitPendingSpaceIfNeeded('op');
                outStr = outStr.replace(/[ ]+$/g, '');
                if (outStr && outStr[outStr.length - 1] !== ' ')
                    outStr += ' ';
                outStr += ch + ' ';
                i++;
                continue;
            }
            if (ch === '(') {
                const prevNonSpace = outStr.replace(/\s+$/g, '').slice(-1);
                const keepTrailingSpace = prevNonSpace && /[=+\-*/%<>&|^!?~,:]/.test(prevNonSpace);
                if (!keepTrailingSpace) {
                    outStr = outStr.replace(/[ ]+$/g, '');
                }
                outStr += '(';
                parenDepth++;
                i++;
                while (i < s.length && isSpace(s[i]))
                    i++;
                continue;
            }
            if (ch === ')') {
                pendingSpace = false;
                outStr = outStr.replace(/[ ]+$/g, '');
                outStr += ')';
                parenDepth = Math.max(0, parenDepth - 1);
                i++;
                continue;
            }
            if (ch === '{') {
                emitPendingSpaceIfNeeded('op');
                const prevNonSpace = outStr.replace(/\s+$/g, '').slice(-1);
                const trimmedOut = outStr.replace(/\s+$/g, '');
                const blockKeywordRegex = /\b(if|for|while|switch|else|do|try|catch|class|struct|namespace|union|enum|case|default)\b[^{}]*$/;
                const endsWithControl = /[\)\]]$/.test(trimmedOut);
                const isInitializerBrace = parenDepth > 0 || (!endsWithControl && !blockKeywordRegex.test(trimmedOut));
                const shouldBreakBeforeBrace = breakBeforeBraces === 'Allman' || breakBeforeBraces === 'GNU';
                let shouldAddSpace = prevNonSpace && !/[\s{[(]/.test(prevNonSpace);
                if (isInitializerBrace) {
                    const lastWordMatch = trimmedOut.match(/([A-Za-z_][A-Za-z0-9_]*)$/);
                    const lastWord = lastWordMatch ? lastWordMatch[1] : '';
                    const keywordsNeedingSpace = new Set(['return', 'co_return', 'throw', 'new']);
                    const prevRequiresSpace = prevNonSpace && /[=,:]/.test(prevNonSpace);
                    shouldAddSpace = keywordsNeedingSpace.has(lastWord) || prevRequiresSpace;
                }
                if (shouldAddSpace) {
                    outStr = outStr.replace(/[ ]+$/g, '');
                    outStr += ' ';
                }
                else {
                    outStr = outStr.replace(/[ ]+$/g, '');
                }
                if (shouldBreakBeforeBrace && !isInitializerBrace && outStr.trim()) {
                    segments.push(outStr.replace(/[ ]+$/g, ''));
                    outStr = '';
                }
                outStr += ch;
                if (isInitializerBrace) {
                    inlineBraceDepth++;
                    i++;
                    continue;
                }
                const afterBrace = s.substring(i + 1).trim();
                if (afterBrace && !afterBrace.startsWith('}')) {
                    segments.push(outStr);
                    outStr = '';
                    i++;
                    while (i < s.length && (s[i] === ' ' || s[i] === '\t'))
                        i++;
                    continue;
                }
                i++;
                continue;
            }
            if (ch === '}') {
                if (inlineBraceDepth > 0) {
                    inlineBraceDepth--;
                    emitPendingSpaceIfNeeded('op');
                    outStr = outStr.replace(/[ ]+$/g, '');
                    outStr += ch;
                    i++;
                    continue;
                }
                if (outStr.trim()) {
                    segments.push(outStr);
                    outStr = '';
                }
                emitPendingSpaceIfNeeded('op');
                outStr += ch;
                let j = i + 1;
                while (j < s.length && (s[j] === ' ' || s[j] === '\t'))
                    j++;
                if (s[j] === ';') {
                    outStr += ';';
                    j++;
                    while (j < s.length && (s[j] === ' ' || s[j] === '\t'))
                        j++;
                    if (j < s.length) {
                        segments.push(outStr);
                        outStr = '';
                        i = j;
                        continue;
                    }
                    else {
                        i = j;
                        continue; // 行结束
                    }
                }
                const afterBrace = s.substring(i + 1).trim();
                if (afterBrace) {
                    const varDeclPattern = /^[A-Za-z_\*\&\:\<\>\[\]\,\s0-9]+;\s*$/;
                    if (varDeclPattern.test(afterBrace) && !/\{/.test(afterBrace) && !/\}/.test(afterBrace) && !/\s/.test(afterBrace.replace(/;\s*$/, ''))) {
                        outStr += ' ' + afterBrace.replace(/\s+$/, '');
                        segments.push(outStr);
                        outStr = '';
                        i = s.length; // 跳到行尾
                        continue;
                    }
                    segments.push(outStr);
                    outStr = '';
                    i++;
                    while (i < s.length && (s[i] === ' ' || s[i] === '\t'))
                        i++;
                    continue;
                }
                i++;
                continue;
            }
            if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(ch)) {
                emitPendingSpaceIfNeeded('id');
                outStr += ch;
                i++;
                continue;
            }
            emitPendingSpaceIfNeeded('op');
            outStr += ch;
            i++;
        }
        // 对每个输出片段做统一规范化（片段可能已在扫描阶段被切开）
        const normalize = (text) => {
            let t = text;
            t = t.replace(/\b(if|for|while|switch|catch)\s*\(/g, '$1 (');
            // 不能用 [^:]+?，否则 case Color::Red: 会被拆成 case Color: :Red :
            t = t.replace(/\bcase\s+(.+?)\s*(?<!:):(?!:)\s*/g, 'case $1: ');
            t = t.replace(/\bdefault\s*:\s*/g, 'default: ');
            const kw = new Set(['if', 'for', 'while', 'switch', 'catch']);
            t = t.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\s+\(/g, (_m, name) => {
                return kw.has(name) ? `${name} (` : `${name}(`;
            });
            t = t.replace(/([\]\>])\s+\(/g, '$1(');
            t = t.replace(/[ \t]+$/g, '');
            t = t.replace(/}\n\s*;/g, '};');
            // 保留占位符：缩进统计必须基于占位文本，否则字面量里的 {} 会污染缩进。
            return t;
        };
        if (outStr.length > 0)
            segments.push(outStr);
        // 规范化后若片段内部被拆成多行（如 case 标签与语句），展开为独立片段
        const expanded = [];
        segments.forEach((seg) => {
            normalize(seg).split('\n').forEach((part) => {
                if (part.length > 0)
                    expanded.push(part);
            });
        });
        return { segments: expanded, open, close, noIndent: false, restore: restoreLiterals };
    }
    for (let idx = 0; idx < rawLines.length; idx++) {
        let line = rawLines[idx];
        line = line.replace(/[ \t]+$/g, '');
        // 跨行原始字符串内部的行必须原样保留（任何 trim/缩进都会改变字符串内容）。
        if (rawStringTerminator) {
            out.push(line);
            blankCount = 0;
            if (line.includes(rawStringTerminator)) {
                rawStringTerminator = null;
            }
            continue;
        }
        const trimmedLeft = line.replace(/^[\t ]+/, '');
        if (inPreprocessorContinuation || trimmedLeft.startsWith('#')) {
            out.push(line);
            inPreprocessorContinuation = /\\$/.test(line);
            blankCount = 0;
            continue;
        }
        if (line.trim() === '') {
            if (blankCount < 1)
                out.push('');
            blankCount++;
            continue;
        }
        blankCount = 0;
        const res = processLine(line, rawLines[idx + 1] || '');
        if (!res.noIndent && res.segments && res.segments.length > 0) {
            const lastSeg = res.segments[res.segments.length - 1];
            if (lastSeg && lastSeg.trim() === '}' && rawLines[idx + 1]) {
                const nextRaw = rawLines[idx + 1].trim();
                const nextBody = nextRaw.replace(/;\s*$/, '');
                if (/^[A-Za-z_\*\&\<\[]/.test(nextRaw) && /;\s*$/.test(nextRaw) && !/=/.test(nextRaw) && !/\s/.test(nextBody)) {
                    res.segments[res.segments.length - 1] = lastSeg + ' ' + nextRaw;
                    idx++;
                    blankCount = 0;
                }
            }
        }
        if (res.noIndent) {
            res.segments.forEach((seg) => {
                out.push(seg);
            });
        }
        else {
            let tempLevel = indentLevel;
            res.segments.forEach((seg, idxInLine) => {
                let text = seg.trimStart();
                const startsClose = text.startsWith('}');
                const isCaseLine = /^case\s+[^:]+:\s*$/.test(text) || /^default:\s*$/.test(text);
                let segLevel = Math.max(0, tempLevel - (startsClose ? 1 : 0));
                if (isCaseLine) {
                    if (!indentCaseLabels && segLevel > 0)
                        segLevel -= 1;
                    text = text.trimEnd();
                }
                out.push(mkIndent(segLevel) + (typeof res.restore === 'function' ? res.restore(text) : text));
                const opens = (seg.match(/\{/g) || []).length;
                const closes = (seg.match(/\}/g) || []).length;
                tempLevel = Math.max(0, tempLevel + opens - closes);
                if (isCaseLine) {
                    const nextSeg = res.segments[idxInLine + 1];
                    if (nextSeg && !/^\s*(case\s+|default:|})/.test(nextSeg)) {
                        tempLevel = tempLevel + 1; // 暂时加一层
                    }
                }
            });
            indentLevel = tempLevel;
        }
    }
    return out.join(EOL);
}
if (!window.cppFormatter) {
    window.cppFormatter = { format: formatCpp };
}
