# @lat: [[Specs#Feature A]]
def do_feature_a():
    pass

def some_decorator(fn):
    return fn

@some_decorator
# @lat: [[Specs#Feature B]]
def do_feature_b():
    pass

# @lat: [[Specs#Nonexistent]]
def do_missing():
    pass
