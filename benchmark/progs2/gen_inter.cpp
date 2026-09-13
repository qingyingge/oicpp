#include "fastio.h"
int main() {
    const int N = 200000;
    for (int i = 1; i <= N; i++) fastprint(i);
    flushout();
    return 0;
}
