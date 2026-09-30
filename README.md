# Jest Dagger Toolchain

Runs your [Jest](https://jestjs.io) tests in Dagger, one check per project,
with every test exported to OpenTelemetry as a span.

## Requirements

Requires Dagger v1.0.0-beta.15 or later.

## Installation

```sh
dagger install github.com/dagger/jest
```

## Usage

```sh
dagger check                                   # every Jest project visible from here
dagger check -l --all                          # one line per project and test file
dagger check --jest --jest-project=web
dagger check --jest --jest-project=web --jest-test-file=src/App.test.jsx
dagger check jest/projects/tests/test --jest-test-file=src/App.test.jsx
dagger check -l --all --jest -f=cli            # each line as flags to reuse
dagger list jest-projects -a
dagger list jest-test-files -a --jest-project=web
```

The toolchain has one check, `test`, at `jest/projects/tests/test`. It runs
once per selected project, over that project's selected test files:

- With every test file of the project selected, it runs `jest` with no file
  arguments, so Jest's own configuration decides what runs.
- With some filtered out, it runs `jest --passWithNoTests --runTestsByPath
  <files>` over the selected files only.

`dagger check -l` without `--all` prints a single row with `*` in the
`JEST-PROJECT` and `JEST-TEST-FILE` columns. The `*` stands for every
project and test file in view; add `--all` to list them one per row.

Use `dagger check` to run tests, in CI too: it fails when a test fails.

### Selection flags

| Flag | Selects |
| --- | --- |
| `--jest`, `--by-jest` | checks from this module |
| `--check test` | checks named `test`, in every installed module |
| `--jest-project=PATH` | one project, by root relative to the workspace root (repeatable) |
| `--jest-projects` | every project |
| `--jest-test-file=PATH` | one test file, by path relative to its project (repeatable) |
| `--jest-tests` | every test file |

`dagger check --help` lists the flags in effect. They can change when another
installed module has a `JestProject` or `JestTestFile` type too.

Each project is its own check. A failure names the project and the step
that failed, with the end of its output:

```
Jest project a: install failed (npm install, exit 1):
npm error ...
Jest project b: jest failed (exit 1):
FAIL src/sum.test.js
...
Jest project c: jest is not installed: add it to the devDependencies of c/package.json (...)
```

## Projects

A project is a directory holding a `jest.config.js`, `.mjs`, `.cjs`, `.ts`,
`.mts`, `.cts` or `.json`: the names Jest loads on its own when run there.
`node_modules` is not searched. Keys are relative to the workspace root.

- A `jest` key in `package.json` also configures Jest, but `package.json`
  marks every npm package, so it is not a marker.
- A named variant such as `jest.config-eslint-7.js` is not a marker either:
  Jest never loads it by itself, only through `--config` or a `projects`
  entry, so its directory is not a project Jest would run on its own. It is
  still used when a root config's `projects` names it (below).

### Your working directory selects projects

Which projects you see depends on where you run `dagger`:

- **Inside a project's subdirectory:** the enclosing project, plus any
  projects nested below that directory.
- **At a project root:** that project and the projects below it, never the
  ones above it.
- **In a directory that belongs to no project:** the projects below it.

Given `web/jest.config.js` and `api/jest.config.js`:

```sh
dagger check                    # runs web and api
cd web/src && dagger check      # runs web only
cd web && dagger list jest-projects -a   # web
```

### Monorepos with a root `projects` config

When a project's config lists `projects` as string literals, for example

```js
module.exports = {
  projects: ["<rootDir>/packages/*/jest.config.js"],
};
```

the projects it names are run by it, so they are not keyed again: `dagger
check` from the root runs the root project once, and Jest runs every package
through it. Their test files are keyed under the root project
(`packages/a/src/a.test.js`) and read with each package's own config. From
inside a package (`cd packages/a && dagger check`) the package is a project of
its own and runs alone. A `projects` list that is not all string literals is
not read, and its nested projects are keyed on their own as well.

## Test files

Test files are found in one search of the project, with `node_modules` and
git-ignored files skipped; listing runs no container and no Jest. They are
the files the project's Jest config would run, read statically from its
config file:

- `testMatch`, `testRegex`, `testPathIgnorePatterns`, `roots` and `rootDir`
  are honoured when they are literal strings or arrays of them.
- Anything else, and a config that exports something other than an object
  literal (a function call such as `module.exports = buildConfig(...)`, an
  import), falls back to Jest's defaults: `testMatch`
  `**/__tests__/**/*.?([mc])[jt]s?(x)` and `**/?(*.)+(spec|test).?([mc])[jt]s?(x)`,
  ignoring `/node_modules/`.
- Nested projects report their own files, unless a `projects` list names them.

So static discovery can be wrong about a config it cannot read:

- It may list a helper that the config excludes. Selecting only that file
  runs nothing and passes.
- It may miss a test that only the config's own logic finds. That test still
  runs whenever the whole project runs, because that run uses Jest's config.
- A project with no test file it can find reports no test files, so `dagger
  check` does not run it; call its `test` function from a module instead.

## Dependencies

Jest runs from the project directory.

**Without a `package.json`** at or above the project, `npx` fetches Jest.

**With one**, dependencies are installed and the project's own Jest runs: the
nearest `node_modules/.bin/jest` between the project and the install root, or
yarn's under Plug'n'Play. If there is none, the check fails with `jest is not
installed: add it to the devDependencies of ...` rather than fetching a
different version.

- **Install root.** The nearest workspace root at or above the project: a
  directory with `pnpm-workspace.yaml`, or a `package.json` with
  `"workspaces"`. Failing that, the nearest lockfile's directory, then the
  nearest `package.json`'s. A package inside a monorepo therefore installs
  with the whole workspace and sees the files above it, such as a shared
  `jest.base.config.js`.
- **Package manager.** The `packageManager` setting if set. Otherwise the
  `packageManager` field of the install root's `package.json`, then its
  lockfile (`pnpm-lock.yaml` or `pnpm-workspace.yaml`: pnpm, `yarn.lock`:
  yarn, `bun.lock`/`bun.lockb`: bun), then npm. pnpm and yarn run through
  corepack, installed when the image lacks it, at the version the
  `packageManager` field pins.
- **Caching.** The install sees only what it reads: every `package.json`,
  lockfiles, `pnpm-workspace.yaml`, `.npmrc`, `.yarnrc*`,
  `.yarn/{releases,plugins,patches}`, `.pnpmfile.cjs`, `bunfig.toml` and
  `patches/`, plus the directories of local dependencies (`file:`, `link:`,
  `portal:` specs), which the install copies or links, and the files
  workspace packages name in `"bin"`, which it links into
  `node_modules/.bin`. The rest of the source
  is laid over the result, so editing a source file does not reinstall. With
  pnpm's `dependenciesMeta` `injected`, or a local dependency outside the
  install root, the install gets the whole source instead. Package manager
  caches, the pnpm store and corepack live on cache volumes.
- **Less noise.** Browser downloads (Playwright, Puppeteer, Cypress) and git
  hook installers (husky, simple-git-hooks) are switched off.
- **Install scripts** still run, but they see only the install inputs, so a
  `postinstall` or `prepare` script that builds from source fails. Pass
  `installFlags = ["--ignore-scripts"]`, and set `build = true` if the tests
  need the build output.

The install root, or the project itself, is mounted at `/src` without
`node_modules` and without files ignored by `.gitignore`.

With `build` set, the package manager's `run build` runs in the project
before the tests.

## Settings

Set them with `dagger settings`, or in `dagger.toml`:

```sh
dagger settings jest environment TZ=UTC
dagger settings jest installFlags -- --ignore-scripts   # "--" before a value that starts with -
dagger settings -u jest installFlags                    # back to the default
```

```toml
[modules.jest.settings]
baseImageAddress = "node:22-alpine"   # default: node:25-alpine; any image with node and npm
packageManager = "pnpm"               # default: "" (detect); npm, yarn, pnpm or bun
installFlags = ["--ignore-scripts"]   # default: []; appended to the install command
environment = ["TZ=UTC"]              # default: []; KEY=VALUE for the build and the tests
build = true                          # default: false; run the build script before testing
useEnv = true                         # default: false; use the project's own Jest environment
flags = ["--ci"]                      # default: []; flags passed to every jest run
```

Unless `useEnv` is set, the toolchain preloads its register hook through
`NODE_OPTIONS`, so tests are traced without any change to your config. With
`useEnv`, the toolchain's build of `@dagger.io/jest` is linked into
`node_modules`, for a config that names `@dagger.io/jest/node-environment`.

## Using it from another module

`projects(ws)` returns a collection. Build its members with `get(key:)`, narrow
it with `subset(keys:)`, and reach the functions that span the collection
through `batch`:

```dang
let projects = jest.projects(ws)
projects.keys                                   # ["api", "web"]
projects.batch.test(ws)                         # run every project, list the failures
projects.get(key: "web").test(ws)               # run one whole project
projects.get(key: "web").list(ws)               # jest --listTests output
projects.get(key: "web").installRoot(ws)        # where dependencies are installed

let files = projects.get(key: "web").tests(ws)
files.keys                                      # ["src/App.test.jsx", ...]
run(files.subset(keys: ["src/App.test.jsx"]).batch.test(ws))
run(files.get(key: "src/App.test.jsx").test(ws))
```

`JestProjects.test` and `JestProject.test` are plain functions. They are not
checks, so that `dagger check` does not run the same tests twice. The
test-file `test` functions are checks. A check called through a dependency
comes back unrun, so wrap it in a helper that runs it:

```dang
let run(check: Check!): Void {
  if (check.pass == false) {
    raise check.error.message ?? "check failed"
  }
  null
}
```

Settings are constructor arguments:
`jest(build: true, installFlags: ["--ignore-scripts"]).projects(ws)`.

From the command line, `dagger call` cannot select a collection item yet; the
Dagger shell can:

```sh
dagger -c 'jest | projects | get web | list'
```

The end-to-end tests in `.dagger/modules/e2e` exercise all of this.

## Jest OpenTelemetry auto instrumentation

Automatically instrument Jest tests for Open Telemetry.

The toolchain does this automatically, however you can use the library without the toolchain as described below.

### Span attributes

Test spans include `dagger.io/ui.boundary` plus OpenTelemetry test semantic convention attributes: `test.case.name`, `test.case.result.status`, and `test.suite.name`.

Suite spans include `dagger.io/ui.boundary`, `test.suite.name`, and `test.suite.run.status`.

### Test output

Console output emitted with `console.log`, `console.info`, `console.debug`, `console.warn`,
and `console.error` is exported as OpenTelemetry logs on the active test span.

### Installation

Install `@dagger.io/jest` in your project

```shell
npm install @dagger.io/jest
```

### Setup

You can either follow a no-configuration setup or update your current `jest.config.js` file.

#### No configuration setup

Add the following import in your `NODE_OPTIONS` to auto-instrument when running your test

```shell
 "NODE_OPTIONS=\"$NODE_OPTIONS --require @dagger.io/jest/register \" jest
```

:bulb: If your project is in ESM, make sure you first followed [ECMAScript Module setup on Jest](https://jestjs.io/docs/ecmascript-modules)

#### Jest config setup

:warning: This setup may not work if you already have custom environment. If so please follow the
no configuration setup that can take any environment.

The library export an environment that you can use to automatically instrument your tests:

```json
testEnvironment: "@dagger.io/jest/node-environment"
```
