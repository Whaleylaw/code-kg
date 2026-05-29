def greet(name):
    return f"Hello, {name}!"

def some_decorator(fn):
    return fn

@some_decorator
def decorated_greet(name):
    return f"Hey, {name}!"

class Greeter:
    def greet(self, name):
        return f"Hi, {name}!"

    @some_decorator
    def decorated_method(self, name):
        return f"Yo, {name}!"

@some_decorator
class DecoratedGreeter:
    def wave(self, name):
        return f"Wave, {name}!"

DEFAULT_NAME = "World"
