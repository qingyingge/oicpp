#include "fastio.h"
#include <cstdlib>
int main() {
    srand(42);
    int n = 200000, q = 200000;
    fastprint<int>(n); fastprint<int>(q);
    for (int i = 0; i < n; i++) fastprint<int>(rand() % 1000000000);
    for (int i = 0; i < q; i++) {
        if (rand() % 2) { fastprint<int>(1); fastprint<int>(rand() % n); fastprint<int>(rand() % 1000000000); }
        else { int l = rand() % n, r = rand() % n; if (l > r) { int t = l; l = r; r = t; } fastprint<int>(2); fastprint<int>(l); fastprint<int>(r); }
    }
    flushout();
    return 0;
}
