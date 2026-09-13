#include <cstdio>
#include <cstdlib>
int main() {
    srand(42);
    int n = 1000000;
    printf("%d\n", n);
    for (int i = 0; i < n; i++) printf("%d ", rand() % 1000000000);
    printf("\n");
    return 0;
}
