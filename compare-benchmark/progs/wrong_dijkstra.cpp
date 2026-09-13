#include <cstdio>
#include <vector>
#include <queue>
#include <cstring>
using namespace std;
typedef pair<int,int> pii;
vector<pii> g[10005];
int dis[10005];
int main() {
    int n, m, s, t;
    scanf("%d%d", &n, &m);
    for (int i = 0; i < m; i++) {
        int u, v, w;
        scanf("%d%d%d", &u, &v, &w);
        g[u].push_back({v, w});
        g[v].push_back({u, w});
    }
    scanf("%d%d", &s, &t);
    memset(dis, 0x3f, sizeof(dis));
    dis[s] = 0;
    priority_queue<pii> pq;  // BUG: max heap instead of min heap
    pq.push({0, s});
    while (!pq.empty()) {
        auto [d, u] = pq.top(); pq.pop();
        if (d > dis[u]) continue;
        for (auto [v, w] : g[u]) {
            if (dis[u] + w < dis[v]) {
                dis[v] = dis[u] + w;
                pq.push({dis[v], v});
            }
        }
    }
    printf("%d\n", dis[t] > 0x3f3f3f3f ? -1 : dis[t]);
    return 0;
}
