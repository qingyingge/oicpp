#include "fastio.h"
int main() {
    int n = fastscan<int>(), q = fastscan<int>();
    static long long tree[200005];
    auto add = [&](int i, long long v) { for (; i <= n; i += i & -i) tree[i] += v; };
    auto sum = [&](int i) { long long s = 0; for (; i > 0; i -= i & -i) s += tree[i]; return s; };
    for (int i = 0; i < n; i++) { long long x = fastscan<long long>(); add(i + 1, x); }
    for (int i = 0; i < q; i++) {
        int op = fastscan<int>();
        if (op == 1) { int x = fastscan<int>(); long long v = fastscan<long long>(); add(x + 1, v); }
        else { int l = fastscan<int>(), r = fastscan<int>(); fastprint<long long>(sum(r + 1) - sum(l)); }
    }
    flushout();
    return 0;
}
