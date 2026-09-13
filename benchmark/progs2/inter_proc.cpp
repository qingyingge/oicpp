#include "fastio.h"
int main() {
    int x;
    while ((x = fastscan<int>()) != 0 || !feof(stdin)) {
        fastprint(x + 1);
        if (feof(stdin)) break;
    }
    flushout();
    return 0;
}
