// function nonexistent() {}

export function greet(name: string): string {
  // function nonexistent() {}
  return `Hello, ${name}!`;
}

export class Greeter {
  greet(name: string): string {
    return `Hi, ${name}!`;
  }
}

export const DEFAULT_NAME = 'World';
