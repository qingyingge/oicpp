#define NAPI_VERSION 8
#include <node_api.h>
#include <spawn.h>
#include <fcntl.h>
#include <unistd.h>
#include <poll.h>
#include <sys/wait.h>
#include <sys/types.h>
#include <string.h>
#include <stdlib.h>
#include <errno.h>
#include <time.h>
#include <pthread.h>

#define MAX_OUTPUT (64 * 1024 * 1024)

static void drainFd(int fd, char** out, size_t* outLen) {
    size_t cap = 8192, len = 0;
    char* buf = (char*)malloc(cap);
    if (!buf) { *out = NULL; *outLen = 0; return; }
    for (;;) {
        if (len >= cap) {
            if (cap >= MAX_OUTPUT) break;
            cap *= 2;
            buf = (char*)realloc(buf, cap);
        }
        ssize_t r = read(fd, buf + len, cap - len);
        if (r > 0) { len += (size_t)r; continue; }
        if (r == 0) break;
        if (errno == EINTR) continue;
        if (errno == EAGAIN || errno == EWOULDBLOCK) {
            struct pollfd pfd = { fd, POLLIN, 0 };
            int pr = poll(&pfd, 1, 500);
            if (pr == 0) break;
            continue;
        }
        break;
    }
    *out = buf; *outLen = len;
}

static int runOne(const char* path, const char* input, size_t inputLen,
                   int64_t timeoutMs, char** out, size_t* outLen) {
    *out = NULL; *outLen = 0;
    int inPipe[2], outPipe[2], errPipe[2];
    if (pipe2(inPipe, O_CLOEXEC) != 0 || pipe2(outPipe, O_CLOEXEC) != 0 || pipe2(errPipe, O_CLOEXEC) != 0) {
        return -2;
    }

    posix_spawn_file_actions_t actions;
    posix_spawn_file_actions_init(&actions);
    posix_spawn_file_actions_adddup2(&actions, inPipe[0], STDIN_FILENO);
    posix_spawn_file_actions_adddup2(&actions, outPipe[1], STDOUT_FILENO);
    posix_spawn_file_actions_adddup2(&actions, errPipe[1], STDERR_FILENO);

    pid_t pid = -1;
    char* argvChild[] = { (char*)path, NULL };
    extern char** environ;
    int rc = posix_spawn(&pid, path, &actions, NULL, argvChild, environ);
    if (rc != 0) {
        close(inPipe[0]); close(inPipe[1]);
        close(outPipe[0]); close(outPipe[1]);
        close(errPipe[0]); close(errPipe[1]);
        posix_spawn_file_actions_destroy(&actions);
        return -2;
    }
    posix_spawn_file_actions_destroy(&actions);

    close(inPipe[0]); close(outPipe[1]); close(errPipe[1]);

    if (input && inputLen > 0) {
        size_t off = 0;
        while (off < inputLen) {
            ssize_t w = write(inPipe[1], input + off, inputLen - off);
            if (w > 0) { off += (size_t)w; continue; }
            if (errno == EINTR) continue;
            break;
        }
    }
    close(inPipe[1]);

    char* outBuf = NULL; size_t outLen_ = 0;
    char* errBuf = NULL; size_t errLen = 0;
    drainFd(outPipe[0], &outBuf, &outLen_);
    drainFd(errPipe[0], &errBuf, &errLen);
    close(outPipe[0]); close(errPipe[0]);

    int code = -1;
    struct timespec start, now;
    clock_gettime(CLOCK_MONOTONIC, &start);
    for (;;) {
        int status = 0;
        pid_t w = waitpid(pid, &status, WNOHANG);
        if (w == pid) { code = WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status); break; }
        if (w < 0) { code = -2; break; }
        clock_gettime(CLOCK_MONOTONIC, &now);
        int64_t elapsed = (now.tv_sec - start.tv_sec) * 1000 + (now.tv_nsec - start.tv_nsec) / 1000000;
        if (elapsed >= timeoutMs) { kill(pid, SIGKILL); waitpid(pid, &status, 0); code = -3; break; }
        usleep(1000);
    }

    if (errBuf) free(errBuf);
    *out = outBuf; *outLen = outLen_;
    return code;
}

struct RunPairArg {
    const char* path;
    const char* input;
    size_t inputLen;
    int64_t timeoutMs;
    int code;
    char* out;
    size_t outLen;
};

static void* runPairThread(void* arg) {
    RunPairArg* a = (RunPairArg*)arg;
    a->code = runOne(a->path, a->input, a->inputLen, a->timeoutMs, &a->out, &a->outLen);
    return NULL;
}

static napi_value Run(napi_env env, napi_callback_info info) {
    size_t argc = 3;
    napi_value argv[3];
    if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) { napi_throw_error(env, NULL, "cb_info"); return NULL; }

    size_t pathLen = 0;
    napi_get_value_string_utf8(env, argv[0], NULL, 0, &pathLen);
    char* pathBuf = (char*)malloc(pathLen + 1);
    napi_get_value_string_utf8(env, argv[0], pathBuf, pathLen + 1, &pathLen);
    pathBuf[pathLen] = '\0';

    char* input = NULL;
    size_t inputLen = 0;
    if (argc > 1) {
        napi_valuetype t;
        napi_typeof(env, argv[1], &t);
        if (t == napi_string || t == napi_object) {
            void* data = NULL;
            if (napi_get_buffer_info(env, argv[1], &data, &inputLen) == napi_ok && data && inputLen > 0) input = (char*)data;
        }
    }

    int64_t timeoutMs = 10000;
    if (argc > 2) { int64_t v; if (napi_get_value_int64(env, argv[2], &v) == napi_ok) timeoutMs = v; }

    char* outBuf = NULL; size_t outLen = 0;
    int code = runOne(pathBuf, input, inputLen, timeoutMs, &outBuf, &outLen);
    free(pathBuf);

    napi_value result, rCode, rOut;
    napi_create_object(env, &result);
    napi_create_int64(env, code, &rCode);
    napi_set_named_property(env, result, "code", rCode);
    void* bufData = NULL;
    napi_create_buffer_copy(env, outLen, outBuf, &bufData, &rOut);
    napi_set_named_property(env, result, "output", rOut);
    if (outBuf) free(outBuf);
    return result;
}

static napi_value RunPair(napi_env env, napi_callback_info info) {
    size_t argc = 4;
    napi_value argv[4];
    if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) { napi_throw_error(env, NULL, "cb_info"); return NULL; }

    size_t pathLen1 = 0;
    napi_get_value_string_utf8(env, argv[0], NULL, 0, &pathLen1);
    char* path1 = (char*)malloc(pathLen1 + 1);
    napi_get_value_string_utf8(env, argv[0], path1, pathLen1 + 1, &pathLen1);
    path1[pathLen1] = '\0';

    size_t pathLen2 = 0;
    napi_get_value_string_utf8(env, argv[1], NULL, 0, &pathLen2);
    char* path2 = (char*)malloc(pathLen2 + 1);
    napi_get_value_string_utf8(env, argv[1], path2, pathLen2 + 1, &pathLen2);
    path2[pathLen2] = '\0';

    char* input = NULL;
    size_t inputLen = 0;
    if (argc > 2) {
        napi_valuetype t;
        napi_typeof(env, argv[2], &t);
        if (t == napi_string || t == napi_object) {
            void* data = NULL;
            if (napi_get_buffer_info(env, argv[2], &data, &inputLen) == napi_ok && data && inputLen > 0) input = (char*)data;
        }
    }

    int64_t timeoutMs = 10000;
    if (argc > 3) { int64_t v; if (napi_get_value_int64(env, argv[3], &v) == napi_ok) timeoutMs = v; }

    RunPairArg arg1 = { path1, input, inputLen, timeoutMs, 0, NULL, 0 };
    RunPairArg arg2 = { path2, input, inputLen, timeoutMs, 0, NULL, 0 };

    pthread_t t1, t2;
    int p1 = pthread_create(&t1, NULL, runPairThread, &arg1);
    int p2 = pthread_create(&t2, NULL, runPairThread, &arg2);

    if (p1 != 0 || p2 != 0) {
        if (p1 == 0) pthread_join(t1, NULL);
        if (p2 == 0) pthread_join(t2, NULL);
        if (p1 != 0) { arg1.code = runOne(path1, input, inputLen, timeoutMs, &arg1.out, &arg1.outLen); }
        if (p2 != 0) { arg2.code = runOne(path2, input, inputLen, timeoutMs, &arg2.out, &arg2.outLen); }
    } else {
        pthread_join(t1, NULL);
        pthread_join(t2, NULL);
    }

    free(path1); free(path2);

    napi_value result;
    napi_create_object(env, &result);

    napi_value r;
    napi_create_int64(env, arg1.code, &r);
    napi_set_named_property(env, result, "code1", r);
    napi_create_int64(env, arg2.code, &r);
    napi_set_named_property(env, result, "code2", r);

    void* bufData1 = NULL;
    napi_create_buffer_copy(env, arg1.outLen, arg1.out, &bufData1, &r);
    napi_set_named_property(env, result, "out1", r);

    void* bufData2 = NULL;
    napi_create_buffer_copy(env, arg2.outLen, arg2.out, &bufData2, &r);
    napi_set_named_property(env, result, "out2", r);

    if (arg1.out) free(arg1.out);
    if (arg2.out) free(arg2.out);
    return result;
}

static napi_value Spawn(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value argv[1];
    if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) { napi_throw_error(env, NULL, "cb_info"); return NULL; }
    size_t pathLen = 0;
    napi_get_value_string_utf8(env, argv[0], NULL, 0, &pathLen);
    char* pathBuf = (char*)malloc(pathLen + 1);
    napi_get_value_string_utf8(env, argv[0], pathBuf, pathLen + 1, &pathLen);
    pathBuf[pathLen] = '\0';
    int inPipe[2], outPipe[2], errPipe[2];
    if (pipe2(inPipe, O_CLOEXEC) != 0 || pipe2(outPipe, O_CLOEXEC) != 0 || pipe2(errPipe, O_CLOEXEC) != 0) {
        napi_throw_error(env, NULL, "pipe2"); free(pathBuf); return NULL;
    }
    posix_spawn_file_actions_t actions;
    posix_spawn_file_actions_init(&actions);
    posix_spawn_file_actions_adddup2(&actions, inPipe[0], STDIN_FILENO);
    posix_spawn_file_actions_adddup2(&actions, outPipe[1], STDOUT_FILENO);
    posix_spawn_file_actions_adddup2(&actions, errPipe[1], STDERR_FILENO);
    pid_t pid = -1;
    char* argvChild[] = { pathBuf, NULL };
    extern char** environ;
    int rc = posix_spawn(&pid, pathBuf, &actions, NULL, argvChild, environ);
    posix_spawn_file_actions_destroy(&actions);
    free(pathBuf);
    if (rc != 0) {
        close(inPipe[0]); close(inPipe[1]);
        close(outPipe[0]); close(outPipe[1]);
        close(errPipe[0]); close(errPipe[1]);
        napi_throw_error(env, NULL, strerror(rc));
        return NULL;
    }
    close(inPipe[0]); close(outPipe[1]); close(errPipe[1]);
    napi_value result, v;
    napi_create_object(env, &result);
    napi_create_int64(env, pid, &v); napi_set_named_property(env, result, "pid", v);
    napi_create_int32(env, inPipe[1], &v); napi_set_named_property(env, result, "stdinFd", v);
    napi_create_int32(env, outPipe[0], &v); napi_set_named_property(env, result, "stdoutFd", v);
    napi_create_int32(env, errPipe[0], &v); napi_set_named_property(env, result, "stderrFd", v);
    return result;
}

static napi_value Waitpid(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value argv[1];
    if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) { napi_throw_error(env, NULL, "cb_info"); return NULL; }
    int64_t pid = 0;
    napi_get_value_int64(env, argv[0], &pid);
    int status = 0;
    pid_t w = waitpid((pid_t)pid, &status, WNOHANG);
    if (w == pid) {
        int code = WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
        napi_value r; napi_create_int32(env, code, &r); return r;
    }
    napi_value r; napi_create_int32(env, -1, &r); return r;
}

static napi_value WaitpidBlocking(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value argv[2];
    if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok) { napi_throw_error(env, NULL, "cb_info"); return NULL; }
    int64_t pid = 0;
    napi_get_value_int64(env, argv[0], &pid);
    int64_t timeoutMs = 10000;
    if (argc > 1) { int64_t v; if (napi_get_value_int64(env, argv[1], &v) == napi_ok) timeoutMs = v; }
    struct timespec start, now;
    clock_gettime(CLOCK_MONOTONIC, &start);
    for (;;) {
        int status = 0;
        pid_t w = waitpid((pid_t)pid, &status, WNOHANG);
        if (w == pid) {
            int code = WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
            napi_value r; napi_create_int32(env, code, &r); return r;
        }
        if (w < 0) { napi_value r; napi_create_int32(env, -2, &r); return r; }
        clock_gettime(CLOCK_MONOTONIC, &now);
        int64_t elapsed = (now.tv_sec - start.tv_sec) * 1000 + (now.tv_nsec - start.tv_nsec) / 1000000;
        if (elapsed >= timeoutMs) { kill((pid_t)pid, SIGKILL); waitpid((pid_t)pid, &status, 0); int code = WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status); napi_value r; napi_create_int32(env, -3, &r); return r; }
        usleep(1000);
    }
}

static napi_value Init(napi_env env, napi_value exports) {
    napi_property_descriptor descs[5] = {
        { "run", NULL, Run, NULL, NULL, NULL, napi_default, NULL },
        { "runPair", NULL, RunPair, NULL, NULL, NULL, napi_default, NULL },
        { "spawn", NULL, Spawn, NULL, NULL, NULL, napi_default, NULL },
        { "waitpid", NULL, Waitpid, NULL, NULL, NULL, napi_default, NULL },
        { "waitpidBlocking", NULL, WaitpidBlocking, NULL, NULL, NULL, napi_default, NULL }
    };
    napi_define_properties(env, exports, 5, descs);
    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
