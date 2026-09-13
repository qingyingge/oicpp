#include "fastio.h"
#include <algorithm>
#include <vector>
int main() {
    int n = fastscan<int>();
    std::vector<int> a(n);
    for (int i = 0; i < n; i++) a[i] = fastscan<int>();
    std::sort(a.begin(), a.end());
    for (int i = 0; i < n; i++) fastprint<int>(a[i]);
    flushout();
    return 0;
}
