/* eslint-disable @typescript-eslint/no-explicit-any */

declare module "*.png" {
  const value: string;
  export default value;
}

declare module "*.json" {
  const value: Record<string, any>;
  export default value;
}
