#include "app.h"
#include <stdio.h>

void greet(const char *name) {
    printf("Hello, %s!\n", name);
}

void greeter_greet(struct Greeter *g, const char *name) {
    printf("%s %s!\n", g->prefix, name);
}

const char *DEFAULT_NAME = "World";

/* pointer-returning function */
char *make_greeting(const char *name) {
    return NULL;
}

/* double-pointer-returning function */
char **split_lines(const char *text) {
    return NULL;
}

static const char version_string[] = "1.0.0";
