#include <cstdio>
#include <cstdlib>
int main() {
    srand(42);
    int n = 10000, m = 50000;
    printf("%d %d\n", n, m);
    for (int i = 0; i < m; i++) {
        int u = rand() % n + 1, v = rand() % n + 1, w = rand() % 1000 + 1;
        printf("%d %d %d\n", u, v, w);
    }
    printf("1 %d\n", n);
    return 0;
}
