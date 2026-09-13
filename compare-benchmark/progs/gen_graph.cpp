#include "fastio.h"
#include <cstdlib>
int main() {
    srand(42);
    int n = 10000, m = 50000;
    fastprint<int>(n); fastprint<int>(m);
    for (int i = 0; i < m; i++) {
        fastprint<int>(rand() % n); fastprint<int>(rand() % n); fastprint<int>(rand() % 1000000);
    }
    fastprint<int>(0);
    flushout();
    return 0;
}
