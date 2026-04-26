import type { NextConfig } from 'next';

const config: NextConfig = {
  // Workspace deps need to be transpiled by Next when consumed via
  // workspace:* — Next's default is to skip node_modules transpilation.
  transpilePackages: ['@cuped-io/flame', '@cuped-io/flame-react', '@cuped-io/flame-edge'],
};

export default config;
