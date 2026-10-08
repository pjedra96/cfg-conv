# cfgconv

Convert config files between **JSON, YAML, TOML and .env** with one command.

```sh
node bin/cfgconv.js package.json --to toml
node bin/cfgconv.js .env --to yaml --nest
node bin/cfgconv.js docker-compose.yml -o docker-compose.json
```

Instead of reaching for `json2yaml`, `env2json`, `toml2json` and friends, use one tool that
detects the input format from the file name and writes the one you ask for.

## Setup

Requires Node.js 18.3 or newer. In this folder, install the two dependencies once:

```sh
npm install
```

Then run it with `node bin/cfgconv.js`, from this folder or by its full path from anywhere
(e.g. `node C:\tools\cfg-conv\bin\cfgconv.js app.json --to yaml`). `npm start -- <arguments>`
works too, from this folder. The `--` passes the arguments through to cfgconv.

## Usage

```
node bin/cfgconv.js <file> --to <format> [options]
node bin/cfgconv.js <file> -o <output-file>
cat <file> | node bin/cfgconv.js --from <format> --to <format>
```

| Option | Description |
| --- | --- |
| `-t, --to <format>` | Output format. Inferred from `-o` if omitted |
| `-f, --from <format>` | Input format. Inferred from the file name if omitted |
| `-o, --output <file>` | Write to a file instead of stdout |
| `-i, --indent <n>` | Indent for JSON/YAML output (default 2) |
| `-n, --nest` | `.env` input: split keys on the separator into nested objects |
| `--infer` | `.env` input: turn unquoted `true`/`false`/`null`/numbers into real types |
| `-s, --separator <str>` | Separator for nested `.env` keys (default `__`) |
| `--keep-case` | `.env` output: keep key case instead of `UPPER_CASING` |

Formats: `json`, `yaml` (`yml`), `toml`, `env` (`dotenv`). Files named `.env`, `.env.local`,
`.env.production` or `*.env` are recognised as `.env`.

## Examples

**JSON → .env**: nested keys are joined with `__`, the convention used by Docker, ASP.NET,
Pydantic and others.

```sh
$ node bin/cfgconv.js examples/app.json --to env
NAME=my-app
VERSION=1.2.0
DEBUG=false
PORT=8080
DESCRIPTION=
DATABASE__HOST=localhost
DATABASE__PORT=5432
DATABASE__PASSWORD='p@ss word#1'
FEATURES__0=auth
FEATURES__1=billing
MOTD="Hello\n'world'"
```

**.env → YAML**: `--nest` rebuilds the structure, `--infer` restores numbers and booleans.

```sh
$ node bin/cfgconv.js examples/.env --to yaml --nest --infer
DATABASE:
  HOST: localhost
  PORT: 5432
DEBUG: true
API_URL: https://example.com/v1#section
GREETING: |-
  Hello
  World
RAW: literal $HOME \n
MULTI: |-
  line one
  line two
EMPTY: ""
SERVERS:
  - a.example.com
  - b.example.com
```

**Pipes** work too:

```sh
curl -s https://example.com/config.json | node bin/cfgconv.js -f json -t yaml
```

## What gets converted, and what can't be

Formats don't all support the same things, so cfgconv tells you rather than guessing silently:

- **TOML has no `null`**: null values are dropped, with a warning on stderr for each one.
- **TOML and .env need a top-level object**: converting a JSON array to them fails with a clear error.
- **.env values are always strings**: use `--infer` to get numbers and booleans back.
  Quoted values (`"42"`) always stay strings.
- **.env keys**: characters other than letters, digits and `_` become `_`, and keys are upper-cased
  (unless `--keep-case`). If two keys end up identical (`a-b` and `a_b`), the conversion fails.
- **Comments** are not carried over between formats.
- **Multi-document YAML** (`---` separators) isn't supported yet.
- **.env variable expansion** (`${OTHER}`) is not performed; values are copied as written.

## Project layout

- `bin/cfgconv.js` - the command: reads the options, the input and writes the output
- `src/index.js` - format detection and conversion between the four formats
- `src/env.js` - `.env` parsing and writing
- `test/` - tests, run with `npm test`
- `examples/` - sample files used in the examples above

## License

MIT
