module.exports = {
  apps: [
    {
      name: 'api',
      cwd: './apps/api',
      script: 'npx',
      args: 'tsx src/index.ts',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'web',
      cwd: './apps/web',
      script: 'npx',
      args: 'next start -p 3000',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
