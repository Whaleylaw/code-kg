export function greet(name) {
  return `Hello, ${name}!`;
}

export class Greeter {
  greet(name) {
    return `Hi, ${name}!`;
  }
}

export const Welcome = ({ name }) => {
  return <h1>Hello, {name}!</h1>;
};

export const DEFAULT_NAME = 'World';
