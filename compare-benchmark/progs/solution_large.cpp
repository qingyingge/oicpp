#include <cstdio>
#include <vector>
#include <algorithm>
#include <cstring>
static long long tmp[1000005];
static int a[1000005], b[1000005];
long long merge_sort(int *a, int l, int r) {
    if (l >= r) return 0;
    int mid = (l + r) >> 1;
    long long res = merge_sort(a, l, mid) + merge_sort(a, mid + 1, r);
    int i = l, j = mid + 1, k = l;
    while (i <= mid && j <= r) {
        if (a[i] <= a[j]) tmp[k++] = a[i++];
        else { tmp[k++] = a[j++]; res += mid - i + 1; }
    }
    while (i <= mid) tmp[k++] = a[i++];
    while (j <= r) tmp[k++] = a[j++];
    for (int x = l; x <= r; x++) a[x] = (int)tmp[x];
    return res;
}
int main() {
    int n, rep = 3;
    scanf("%d", &n);
    for (int i = 0; i < n; i++) scanf("%d", &a[i]);
    memcpy(b, a, sizeof(int) * n);
    for (int r = 0; r < rep; r++) {
        memcpy(a, b, sizeof(int) * n);
        long long ans = merge_sort(a, 0, n - 1);
        if (r == rep - 1) printf("%lld\n", ans);
    }
    return 0;
}
