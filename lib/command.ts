import { escapeArg } from './parsers'

export class Command {
  readonly name: string
  readonly args: (string | number)[]

  constructor(name: string, ...args: (string | number)[]) {
    if (args.length === 1 && Array.isArray(args[0])) {
      args = args[0] as (string | number)[]
    }
    this.name = name
    this.args = args
    this.toString = this.toString.bind(this)
  }

  static cmd(name: string, ...args: (string | number)[]): Command {
    if (args.length === 1) {
      return new Command(name, args[0])
    }
    return new Command(name, ...args)
  }

  toString(): string {
    const escaped = this.args.map(escapeArg).join(' ')
    return `${this.name} ${escaped}`
  }
}
