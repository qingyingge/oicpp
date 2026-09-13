#include "fastio.h"
int main() {
    int n = fastscan<int>(), q = fastscan<int>();
    static long long seg[800005];
    int size = 1; while (size < n) size *= 2;
    for (int i = 0; i < n; i++) seg[size + i] = fastscan<long long>();
    for (int i = size - 1; i >= 1; i--) seg[i] = seg[i*2] + seg[i*2+1];
    auto upd = [&](int p, long long v) { p += size; seg[p] += v; for (p /= 2; p >= 1; p /= 2) seg[p] = seg[p*2] + seg[p*2+1]; };
    auto qry = [&](int l, int r) { long long s = 0; l += size; r += size; while (l <= r) { if (l % 2) s += seg[l++]; if (!(r % 2)) s += seg[r--]; l /= 2; r /= 2; } return s; };
    for (int i = 0; i < q; i++) {
        int op = fastscan<int>();
        if (op == 1) { int x = fastscan<int>(); long long v = fastscan<long long>(); upd(x, v); }
        else { int l = fastscan<int>(), r = fastscan<int>(); fastprint<long long>(qry(l, r)); }
    }
    flushout();
    return 0;
}
