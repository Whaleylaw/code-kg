#include <stdio.h>

void greet(const char *name) {
    printf("Hello, %s!\n", name);
}

struct Greeter {
    char *prefix;
};

const char *DEFAULT_NAME = "World";
