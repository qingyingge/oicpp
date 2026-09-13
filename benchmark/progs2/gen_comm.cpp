#include "fastio.h"
#include <cstdlib>
int main() {
    srand(42);
    const int N = 200000;
    for (int i = 1; i <= N; i++) fastprint(rand() % 1000000);
    flushout();
    return 0;
}
