pub fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}

pub struct Greeter {
    pub name: String,
}

impl Greeter {
    pub fn new(name: &str) -> Self {
        Greeter {
            name: name.to_string(),
        }
    }

    pub fn greet(&self) -> String {
        format!("Hi, {}!", self.name)
    }
}

pub trait Greeting {
    fn hello(&self) -> String;
}

pub const DEFAULT_NAME: &str = "World";

pub enum Color {
    Red,
    Green,
    Blue,
}
