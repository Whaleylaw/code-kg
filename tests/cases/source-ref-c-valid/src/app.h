#ifndef APP_H
#define APP_H

struct Greeter {
    char *prefix;
    int count;
};

enum Color { RED, GREEN, BLUE };

struct JSObject {
    int class_id;
    union {
        struct {
            uint8_t extensible : 1;
            uint8_t is_exotic : 1;
        };
        uint16_t flags;
    };
};

typedef int ErrorCode;

enum {
    JS_TAG_INT = 0,
    JS_TAG_BOOL = 1,
};

typedef enum {
    JS_GC_OBJ_TYPE_JS_OBJECT,
    JS_GC_OBJ_TYPE_FUNCTION_BYTECODE,
} JSGCObjectTypeEnum;

typedef enum JSPromiseStateEnum {
    JS_PROMISE_PENDING,
    JS_PROMISE_FULFILLED,
    JS_PROMISE_REJECTED,
} JSPromiseStateEnum;

/* pointer typedef — declarator is pointer_declarator wrapping type_identifier */
typedef struct __Ctx *AppCtx;

#define MAX_SIZE 100
#define CLAMP(x, lo, hi) ((x) < (lo) ? (lo) : (x) > (hi) ? (hi) : (x))

#ifdef __cplusplus
extern "C" {
#endif

void greet(const char *name);

#if defined(APP_EXTRAS)
void extra_func(void);
#else
void fallback_func(void);
#endif

#ifdef __cplusplus
}
#endif

#endif
