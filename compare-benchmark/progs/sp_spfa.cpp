#include "fastio.h"
#include <vector>
#include <queue>
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
    static bool inq[10005];
    for (int i = 0; i < n; i++) dist[i] = 2000000000;
    dist[s] = 0;
    std::queue<int> q;
    q.push(s); inq[s] = true;
    while (!q.empty()) {
        int u = q.front(); q.pop(); inq[u] = false;
        for (auto& e : g[u]) if (dist[u] + e.w < dist[e.v]) {
            dist[e.v] = dist[u] + e.w;
            if (!inq[e.v]) { q.push(e.v); inq[e.v] = true; }
        }
    }
    for (int i = 0; i < n; i++) fastprint<int>(dist[i] == 2000000000 ? -1 : dist[i]);
    flushout();
    return 0;
}
