#include "fastio.h"
#include <vector>
#include <queue>
#include <functional>
#include <cstring>
struct Edge { int v, w; };
int main() {
    int n = fastscan<int>(), m = fastscan<int>();
    static std::vector<Edge> g[10005];
    for (int i = 0; i < m; i++) {
        int u = fastscan<int>(), v = fastscan<int>(), w = fastscan<int>();
        g[u].push_back({v, w});
    }
    int s = fastscan<int>();
    static int dist[10005];
    for (int i = 0; i < n; i++) dist[i] = 2000000000;
    dist[s] = 0;
    std::priority_queue<std::pair<int,int>, std::vector<std::pair<int,int>>, std::greater<std::pair<int,int>>> pq;
    pq.push({0, s});
    while (!pq.empty()) {
        auto [d, u] = pq.top(); pq.pop();
        if (d != dist[u]) continue;
        for (auto& e : g[u]) if (dist[u] + e.w < dist[e.v]) { dist[e.v] = dist[u] + e.w; pq.push({dist[e.v], e.v}); }
    }
    for (int i = 0; i < n; i++) fastprint<int>(dist[i] == 2000000000 ? -1 : dist[i]);
    flushout();
    return 0;
}
