#include "fastio.h"
#include <cstring>
int main() {
    char welcome[131072];
    memset(welcome, 'W', sizeof(welcome) - 1);
    welcome[sizeof(welcome) - 1] = '\n';
    fwrite(welcome, 1, sizeof(welcome), stdout);
    fflush(stdout);

    int x;
    while ((x = fastscan<int>()) != 0 || !feof(stdin)) {
        fastprint(x + 1);
        if (feof(stdin)) break;
    }
    flushout();
    return 0;
}
