import { fileURLToPath } from "url";
import path from "node:path";
import { writeFile, mkdir } from "fs/promises";
import init from "./index.js"; // Assuming this is your Fastify app initializer
import { docsHtml } from "./docs.js";
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
    await mkdir(outputDir, { recursive: true });
    const jsonSpec = JSON.stringify(app.swagger(), null, 2);
    const yamlSpec = app.swagger({ yaml: true });
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
