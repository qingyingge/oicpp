#include "fastio.h"
#include <cstdlib>
int main() {
    srand(42);
    int n = 200000;
    fastprint<int>(n);
    for (int i = 0; i < n; i++) fastprint<int>(rand() % 1000000000);
    flushout();
    return 0;
}
