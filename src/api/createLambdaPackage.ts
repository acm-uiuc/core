import { readFile, writeFile } from "node:fs/promises";
function getPath(url: string) {
  const result = new URL(import.meta.url);
  const pathname = result.pathname;
  const pathArray = pathname.split("/");
  const basename = pathArray.pop();
  const dirname = pathArray.join("/");

  return { pathname, dirname, basename };
}
const packagesToTransfer = [
  "moment-timezone",
  "passkit-generator",
  "fastify",
  "@fastify/swagger",
  "@fastify/swagger-ui",
  "zod",
  "argon2",
  "ioredis",
];
const filePath = `${getPath("package.json").dirname}/package.json`;
const writeFilePath = `${getPath("package.json").dirname}/package.lambda.json`;
const packageJson = JSON.parse((await readFile(filePath)).toString());
const basePackageJson = {
  name: "infra-core-api",
  version: "1.0.0",
  description: "",
  main: "index.js",
  author: "ACM@UIUC",
  license: "BSD-3-Clause",
  type: "module",
  dependencies: {} as Record<string, string>,
  devDependencies: {},
};
for (const key in packageJson.dependencies) {
  if (packagesToTransfer.includes(key)) {
    const version = packageJson.dependencies[key];
    basePackageJson.dependencies[key] = version;
  }
}
const str = JSON.stringify(basePackageJson);
await writeFile(writeFilePath, str);
