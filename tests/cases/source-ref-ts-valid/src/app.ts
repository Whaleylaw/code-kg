export function greet(name: string): string {
  return `Hello, ${name}!`;
}

export class Greeter {
  greet(name: string): string {
    return `Hi, ${name}!`;
  }
}

export const DEFAULT_NAME = 'World';

export type Config = {
  name: string;
  verbose: boolean;
};

export interface Logger {
  log(msg: string): void;
  warn(msg: string): void;
}
