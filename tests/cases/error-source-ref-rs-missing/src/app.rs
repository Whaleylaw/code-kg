pub fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}

pub struct Greeter {
    pub name: String,
}

impl Greeter {
    pub fn greet(&self) -> String {
        format!("Hi, {}!", self.name)
    }
}

pub const DEFAULT_NAME: &str = "World";
