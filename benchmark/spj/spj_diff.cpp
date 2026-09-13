#include "fastio.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

// SPJ stdin format:
//   Line 1: integer N (byte length of expected output)
//   Next N bytes: expected output
//   Remaining bytes: actual output
// Compares byte-by-byte.
//   If identical: exit 0, stdout "AC"
//   If different: exit 1, stdout "WA <first_diff_pos>"

int main() {
    // Read entire stdin into memory
    std::vector<unsigned char> all;
    char buf[1 << 20];
    while (true) {
        int n = fread(buf, 1, 1 << 20, stdin);
        if (n <= 0) break;
        all.insert(all.end(), buf, buf + n);
    }

    // Parse N from first line
    size_t pos = 0;
    int N = 0;
    while (pos < all.size() && all[pos] >= '0' && all[pos] <= '9') {
        N = N * 10 + (all[pos] - '0');
        pos++;
    }
    if (pos < all.size()) pos++; // skip newline after N

    if (pos + (size_t)N > all.size()) {
        fprintf(stdout, "WA input too short\n");
        return 1;
    }

    const unsigned char* expected = all.data() + pos;
    const unsigned char* actual = all.data() + pos + N;
    int actualLen = (int)all.size() - (int)pos - N;

    // Compare
    int minLen = N < actualLen ? N : actualLen;
    for (int i = 0; i < minLen; i++) {
        if (expected[i] != actual[i]) {
            fprintf(stdout, "WA byte %d: expected %d got %d\n", i, expected[i], actual[i]);
            return 1;
        }
    }
    if (N != actualLen) {
        fprintf(stdout, "WA length mismatch: expected %d got %d\n", N, actualLen);
        return 1;
    }
    fprintf(stdout, "AC\n");
    return 0;
}
