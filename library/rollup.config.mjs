import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import typescript from "@rollup/plugin-typescript";

const external = (id) =>
  id.startsWith("@opentelemetry/") ||
  // also keep Node builtins external for a library
  id === "node:fs" ||
  id === "node:path" ||
  id === "node:crypto" ||
  id === "fs" ||
  id === "path" ||
  id === "crypto" ||
  id === "@jest/globals";

const config = {
  input: "src/index.ts",
  plugins: [
    typescript({
      tsconfig: "./tsconfig.json",
      declaration: false,
      declarationMap: false,
    }),
    resolve({ preferBuiltins: true }),
    commonjs(),
  ],
  external,
  output: [
    {
      file: "dist/cjs/index.cjs",
      format: "cjs",
      exports: "named",
      sourcemap: true,
    },
    {
      file: "dist/esm/index.mjs",
      format: "es",
      sourcemap: true,
    },
  ],
};

export default config;
