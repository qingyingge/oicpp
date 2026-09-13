#include <cstdio>
#include <vector>
#include <algorithm>
int main() {
    int n;
    scanf("%d", &n);
    std::vector<int> a(n);
    for (int i = 0; i < n; i++) scanf("%d", &a[i]);
    std::sort(a.begin(), a.end(), std::greater<int>());
    for (int i = 0; i < n; i++) printf("%d ", a[i]);
    printf("\n");
    return 0;
}
