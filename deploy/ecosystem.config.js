module.exports = {
  apps: [{
    name: 'arjun',
    script: 'src/server.js',
    cwd: '/home/ec2-user/arjun',
    instances: 1,
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      DOTENV_CONFIG_QUIET: 'true'
    },
    max_memory_restart: '512M',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: '/home/ec2-user/arjun/logs/error.log',
    out_file: '/home/ec2-user/arjun/logs/app.log',
    merge_logs: true,
    watch: false,
    autorestart: true,
    restart_delay: 5000,
    max_restarts: 10
  }]
};
