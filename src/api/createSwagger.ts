import { fileURLToPath } from "url";
import path from "node:path";
import { writeFile, mkdir, rm } from "fs/promises";
import init from "./index.js"; // Assuming this is your Fastify app initializer
import { docsHtml, securitySchemes } from "./docs.js";
import yaml from "yaml";

/**
 * Generates and saves Swagger/OpenAPI specification files.
 */
async function createSwaggerFiles() {
  try {
    const app = await init(false, false);
    await app.ready();
    console.log("App is ready. Generating specs...");
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const outputDir = path.resolve(__dirname, "..", "..", "dist_ui", "docs");
    await rm(outputDir, { recursive: true, force: true });
    await mkdir(outputDir, { recursive: true });
    const swaggerConfig = app.swagger();
    const realSwaggerConfig = JSON.parse(JSON.stringify(swaggerConfig));
    // set version
    if (process.env.VITE_BUILD_HASH) {
      realSwaggerConfig.info = realSwaggerConfig.info || {};
      realSwaggerConfig.info.version = process.env.VITE_BUILD_HASH;
    }
    realSwaggerConfig.components = realSwaggerConfig.components || {};
    realSwaggerConfig.components.securitySchemes = securitySchemes;
    const jsonSpec = JSON.stringify(realSwaggerConfig, null, 2);
    const doc = new yaml.Document();
    doc.contents = realSwaggerConfig;
    const yamlSpec = doc.toString();
    await writeFile(path.join(outputDir, "openapi.json"), jsonSpec);
    await writeFile(path.join(outputDir, "openapi.yaml"), yamlSpec);
    await writeFile(path.join(outputDir, "index.html"), docsHtml);

    console.log(`✅ Swagger files successfully generated in ${outputDir}`);
    await app.close();
  } catch (err) {
    console.error("❌ Failed to generate Swagger files:", err);
    process.exit(1);
  }
}

createSwaggerFiles();
