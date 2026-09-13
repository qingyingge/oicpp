#include <cstdio>
#include <cstring>
#include <cstdlib>
static char __buf[1 << 20]; static int __idx = 0; static int __size = 0;
inline char readchar() {
    if (__idx >= __size) { __size = (int)fread(__buf, 1, 1 << 20, stdin); __idx = 0; if (__size == 0) return 0; }
    return __buf[__idx++];
}
template<typename T> T fastscan() {
    char c; T x = 0; bool neg = false;
    do { c = readchar(); } while (c <= ' ' && c);
    if (c == '-') { neg = true; c = readchar(); }
    while (c > ' ') { x = x * 10 + (c - '0'); c = readchar(); }
    return neg ? -x : x;
}
static char __outbuf[1 << 20]; static int __oidx = 0;
inline void flushout() { if (__oidx) { fwrite(__outbuf, 1, __oidx, stdout); __oidx = 0; } }
template<typename T> void fastprint(T x) {
    if (x == 0) { __outbuf[__oidx++] = '0'; __outbuf[__oidx++] = ' '; return; }
    char tmp[32]; int t = 0;
    if (x < 0) { __outbuf[__oidx++] = '-'; x = -x; }
    while (x) { tmp[t++] = (char)('0' + x % 10); x /= 10; }
    while (t--) __outbuf[__oidx++] = tmp[t];
    __outbuf[__oidx++] = ' ';
    if (__oidx >= (1 << 20) - 40) flushout();
}
struct FastIOInit { ~FastIOInit() { flushout(); } } __fastio_init;
