import { readFileSync } from "fs";

const emptySourceMapAsBase64 = Buffer.from(
  JSON.stringify({ version: 3, sources: [], names: [], mappings: "" }),
).toString("base64");

export const excludeVendorFromSourceMapPlugin = () => ({
  name: 'excludeVendorFromSourceMap',
  setup(build) {
    build.onLoad({ filter: /node_modules.+\.(js|ts|mjs|cjs)$/ }, (args) => {
      return {
        contents: `${readFileSync(args.path, 'utf8')}\n//# sourceMappingURL=data:application/json;base64,${emptySourceMapAsBase64}`,
        loader: 'default'
      };
    });
  }
});
