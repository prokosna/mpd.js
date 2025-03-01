import { escapeArg } from './parsers'

export class Command {
  readonly name: string
  readonly args: (string | number)[]

  constructor(name: string, ...args: (string | number | (string | number)[])[]){
    if (args.length === 1 && Array.isArray(args[0])) {
      this.args = args[0] as (string | number)[]
    } else {
      this.args = args as (string | number)[]
    }
    this.name = name
    this.toString = this.toString.bind(this)
  }

  static cmd(name: string, ...args: (string | number | (string | number)[])[]): Command {
    return new Command(name, ...args)
  }

  toString(): string {
    const escaped = this.args.map(escapeArg).join(' ')
    return `${this.name} ${escaped}`
  }
}
