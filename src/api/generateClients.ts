import { execSync } from "child_process";
import fs from "fs";
import path from "path";

interface GeneratorConfig {
  additionalProperties: Record<string, string | boolean>;
  postHook?: CallableFunction;
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
  const packageJsonPath = path.join(process.cwd(), "package.json");

  if (!fs.existsSync(packageJsonPath)) {
    return {};
  }

  const content = fs.readFileSync(packageJsonPath, "utf-8");
  return JSON.parse(content) as PackageJson;
}

const packageJson = loadPackageJson();

const config: Config = {
  specFile: process.env.OPENAPI_SPEC || "/var/dist_ui/docs/openapi.json",
  outputDir: process.env.OUTPUT_DIR || "dist/clients",
  version: process.env.VITE_BUILD_HASH || packageJson.version || "1.0.0",
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
      withoutRuntimeChecks: true, // API itself will error if the response does not conform
    },
    postHook: patchPackageJson,
  },
  // python: {
  //   additionalProperties: {
  //     packageName: "acm-uiuc-core-client",
  //     packageVersion: config.version,
  //     projectName: "acm-uiuc-core-client",
  //   },
  // },
};

function patchPackageJson(): void {
  const baseDir = path.join(config.outputDir, "typescript-fetch");
  const pkgPath = path.join(baseDir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return;
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  pkg.repository = {
    type: "git",
    url: "https://github.com/acm-uiuc/core.git",
  };
  pkg.author = "ACM @ UIUC Infrastructure Team <infra@acm.illinois.edu>";
  pkg.description = "OpenAPI client for the ACM @ UIUC Core API";
  pkg.homepage = "https://core.acm.illinois.edu/docs";
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  console.log(`✓ Patched ${pkgPath}`);

  // Add docs/ to .npmignore
  const npmignorePath = path.join(baseDir, ".npmignore");
  const ignoreEntries = ["docs/", "src/"];
  for (const entry of ignoreEntries) {
    if (fs.existsSync(npmignorePath)) {
      const content = fs.readFileSync(npmignorePath, "utf-8");
      if (!content.includes(entry)) {
        fs.appendFileSync(npmignorePath, `\n${entry}\n`);
      }
    } else {
      fs.writeFileSync(npmignorePath, `${entry}\n`);
    }
    console.log(`✓ Added ${entry} to ${npmignorePath}`);
  }
}

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
    --additional-properties=${propsString} \
    --global-property apiDocs=false,modelDocs=false`);
  if (options.postHook) {
    console.log(`Running post hook for ${language} client in ${outputPath}\n`);
    options.postHook();
  }
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
