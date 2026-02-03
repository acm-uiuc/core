import { execSync } from "child_process";
import fs from "fs";
import path from "path";

interface GeneratorConfig {
  additionalProperties: Record<string, string | boolean>;
}

interface Config {
  specFile: string;
  outputDir: string;
  version: string;
}

interface PackageJson {
  name?: string;
  version?: string;
}

function loadPackageJson(): PackageJson {
  const packageJsonPath = path.join(process.cwd(), "../../package.json");

  if (!fs.existsSync(packageJsonPath)) {
    return {};
  }

  const content = fs.readFileSync(packageJsonPath, "utf-8");
  return JSON.parse(content) as PackageJson;
}

const packageJson = loadPackageJson();

const config: Config = {
  specFile: process.env.OPENAPI_SPEC || "/var/dist_ui/docs/openapi.json",
  outputDir: process.env.OUTPUT_DIR || "../../dist/clients",
  version: packageJson.version || "1.0.0",
};

const generators: Record<string, GeneratorConfig> = {
  "typescript-fetch": {
    additionalProperties: {
      npmName: "@acm-uiuc/core-client",
      npmVersion: config.version,
      supportsES6: true,
      typescriptThreePlus: true,
      importFileExtension: ".js",
      licenseName: "BSD-3-Clause",
      gitUserId: "acm-uiuc",
      gitRepoId: "core",
      gitHost: "github.com",
      withoutRuntimeChecks: true, // API itself will error if the response does not conform
    },
  },
  // python: {
  //   additionalProperties: {
  //     packageName: "acm-uiuc-core-client",
  //     packageVersion: config.version,
  //     projectName: "acm-uiuc-core-client",
  //   },
  // },
};

function run(cmd: string): void {
  console.log(`Running: ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

function generate(language: string, options: GeneratorConfig): void {
  const outputPath = path.join(config.outputDir, language);
  const propsString = Object.entries(options.additionalProperties)
    .map(([k, v]) => `${k}=${v}`)
    .join(",");

  run(`npx @openapitools/openapi-generator-cli generate \
    -i ${config.specFile} \
    -g ${language} \
    -o ${outputPath} \
    --additional-properties=${propsString}`);

  console.log(`✓ Generated ${language} client in ${outputPath}\n`);
}

function main(): void {
  console.log(`Using version ${config.version}\n`);

  if (!fs.existsSync(config.specFile)) {
    console.error(`Error: Spec file '${config.specFile}' not found`);
    process.exit(1);
  }

  fs.mkdirSync(config.outputDir, { recursive: true });

  for (const [lang, opts] of Object.entries(generators)) {
    generate(lang, opts);
  }

  console.log("Done! Clients generated successfully.");
}

main();
