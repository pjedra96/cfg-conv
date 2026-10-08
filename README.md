# cfgconv

Convert config files between **JSON, YAML, TOML, .env and .ini** with one command.

```sh
node bin/cfg-conv.js package.json --to toml
node bin/cfg-conv.js .env --to yaml --nest
node bin/cfg-conv.js docker-compose.yml -o docker-compose.json
```

Instead of reaching for `json2yaml`, `env2json`, `toml2json` and friends, use one tool that
detects the input format from the file name and writes the one you ask for.

## Setup

Requires Node.js 18.3 or newer. In this folder, install the two dependencies once:

```sh
npm install
```

Then run it with `node bin/cfg-conv.js`, from this folder or by its full path from anywhere
(e.g. `node C:\tools\cfg-conv\bin\cfg-conv.js app.json --to yaml`). `npm start -- <arguments>`
works too, from this folder. The `--` passes the arguments through to cfgconv.

## Usage

```
node bin/cfg-conv.js <file> --to <format> [options]
node bin/cfg-conv.js <file> -o <output-file>
cat <file> | node bin/cfg-conv.js --from <format> --to <format>
```

| Option | Description |
| --- | --- |
| `-t, --to <format>` | Output format. Inferred from `-o` if omitted |
| `-f, --from <format>` | Input format. Inferred from the file name if omitted |
| `-o, --output <file>` | Write to a file instead of stdout |
| `-i, --indent <n>` | Indent for JSON/YAML output (default 2) |
| `-n, --nest` | `.env` input: split keys on the separator into nested objects |
| `--infer` | `.env`/`.ini` input: turn unquoted `true`/`false`/`null`/numbers into real types (`.ini` also `on`/`off`, `yes`/`no`, `none`, as PHP does) |
| `-s, --separator <str>` | Separator for nested `.env` keys (default `__`) |
| `--keep-case` | `.env` output: keep key case instead of `UPPER_CASING` |

Formats: `json` (`jsonc`, `json5`), `yaml` (`yml`), `toml`, `env` (`dotenv`), `ini`. Files named `.env`, `.env.local`,
`.env.production` or `*.env` are recognised as `.env`; `.jsonc` and `.json5` files are read as JSON.

## Examples

**JSON → .env**: nested keys are joined with `__`, the convention used by Docker, ASP.NET,
Pydantic and others.

```sh
$ node bin/cfg-conv.js examples/app.json --to env
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
$ node bin/cfg-conv.js examples/.env --to yaml --nest --infer
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

**JSON with comments**: comments and trailing commas (`tsconfig.json`, VS Code settings) are fine.
The output is plain JSON or whichever format you ask for.

```sh
$ node bin/cfg-conv.js examples/tsconfig.json --to yaml
compilerOptions:
  target: ES2022
  module: NodeNext
  strict: true
  outDir: dist
include:
  - src
```

**php.ini → JSON**: sections become objects, `extension[] = …` lines become a list, and `--infer`
turns `On`/`Off` and numbers into real values.

```sh
$ node bin/cfg-conv.js examples/php.ini --to json --infer
{
  "PHP": {
    "engine": true,
    "short_open_tag": false,
    "memory_limit": "128M",
    "max_execution_time": 30,
    "error_reporting": "E_ALL & ~E_DEPRECATED & ~E_STRICT",
    "display_errors": false,
    "extension_dir": "ext",
    "extension": [
      "curl",
      "mbstring",
      "openssl"
    ]
  },
  "Date": {
    "date.timezone": "Europe/London"
  },
  "mail function": {
    "SMTP": "localhost",
    "smtp_port": 25
  }
}
```

**Pipes** work too:

```sh
curl -s https://example.com/config.json | node bin/cfg-conv.js -f json -t yaml
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
- **.ini follows PHP's rules** (php.ini, `parse_ini_file`). INI only has sections one level deep, so
  objects nested deeper are written with dotted keys (`db.host = x`), and lists of plain values as
  `key[] = item`. Empty lists and objects can't be written and are dropped with a warning. PHP constant
  expressions (`E_ALL & ~E_NOTICE`) and `${VAR}` are kept as text, not evaluated.
- **Multi-document YAML** (`---` separators) isn't supported yet.
- **.env variable expansion** (`${OTHER}`) is not performed; values are copied as written.

## Project layout

- `bin/cfg-conv.js` - the command: reads the options, the input and writes the output
- `src/index.js` - format detection and conversion between the four formats
- `src/env.js` - `.env` parsing and writing
- `src/ini.js` - `.ini` parsing and writing (PHP rules)
- `test/` - tests, run with `npm test`
- `examples/` - sample files used in the examples above

## License

MIT
