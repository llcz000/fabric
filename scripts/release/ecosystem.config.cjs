const root = '/opt/fabric';

module.exports = {
  apps: [
    { name: 'fabric', script: root + '/start-v2.cjs' },
    { name: 'fabric-readonly', script: root + '/start-recovery.cjs', restart_delay: 1000 },
  ].map(app => ({
    ...app,
    cwd: root,
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    env: { NODE_ENV: 'production' },
  })),
};
