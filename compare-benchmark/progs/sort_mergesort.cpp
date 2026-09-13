#include "fastio.h"
#include <vector>
#include <algorithm>
static void msort(int* a, int l, int r, int* tmp) {
    if (r - l <= 1) return;
    int m = (l + r) / 2;
    msort(a, l, m, tmp); msort(a, m, r, tmp);
    std::merge(a + l, a + m, a + m, a + r, tmp + l);
    std::copy(tmp + l, tmp + r, a + l);
}
int main() {
    int n = fastscan<int>();
    static int a[200005], tmp[200005];
    for (int i = 0; i < n; i++) a[i] = fastscan<int>();
    msort(a, 0, n, tmp);
    for (int i = 0; i < n; i++) fastprint<int>(a[i]);
    flushout();
    return 0;
}
