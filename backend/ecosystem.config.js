module.exports = {
  apps: [
    // 🌐 WEB APPLICATION LAYER (cluster — Redis adapter keeps sockets in sync across instances)
    {
      name: "automation-server",
      script: "/home/automation/backend/server.js",
      instances: "max",
      exec_mode: "cluster",
      max_memory_restart: "2G",
      node_args: "--max-old-space-size=2048",
      env_file: ".env"
    },
    // ⚙️ ISOLATED BACKGROUND CRON PROCESSES (Single-Instance Fork Mode)
    {
      name: "cron-worker-dia",
      script: "./cron-runner.js",
      args: "DIA",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "2G",
      node_args: "--max-old-space-size=2048",
      env_file: ".env"
    },
    {
      name: "cron-worker-ipt",
      script: "./cron-runner.js",
      args: "IPT",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "2G",
      node_args: "--max-old-space-size=2048",
      env_file: ".env"
    },
    {
      name: "cron-worker-shared",
      script: "./cron-runner.js",
      args: "Shared",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "2G",
      node_args: "--max-old-space-size=2048",
      env_file: ".env"
    },
    {
      name: "cron-worker-l3vpn",
      script: "./cron-runner.js",
      args: "L3VPN",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "2G",
      node_args: "--max-old-space-size=2048",
      env_file: ".env"
    },
    {
      name: "cron-worker-ftth",
      script: "./cron-runner.js",
      args: "FTTH",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "3G", // BNG routing lists are large; give it extra room
      node_args: "--max-old-space-size=3072",
      env_file: ".env"
    },
    {
      name: "cron-worker-l2vpn",
      script: "./cron-runner.js",
      args: "L2VPN",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "2G",
      node_args: "--max-old-space-size=2048",
      env_file: ".env"
    },
    {
      name: "cron-worker-l2vpn-circuits",
      script: "./cron-runner.js",
      args: "L2VPNCircuits",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "2G",
      node_args: "--max-old-space-size=2048",
      env_file: ".env"
    },
    {
      name: "cron-worker-switch-config",
      script: "./cron-runner.js",
      args: "Switch",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "1G",
      node_args: "--max-old-space-size=1024",
      env_file: ".env"
    },
    {
      name: "cron-worker-ptp-backfill",
      script: "./cron-runner.js",
      args: "PTP",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "1G",
      node_args: "--max-old-space-size=1024",
      env_file: ".env"
    },
    {
      name: "cron-worker-isis-adjacent",
      script: "./cron-runner.js",
      args: "ISIS",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "1G",
      node_args: "--max-old-space-size=1024",
      env_file: ".env"
    },
    {
      name: "cron-worker-isis-metric",
      script: "./cron-runner.js",
      args: "ISISMetric",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "1G",
      node_args: "--max-old-space-size=1024",
      env_file: ".env"
    },
    {
      name: "cron-worker-isis-stats",
      script: "./cron-runner.js",
      args: "ISISStats",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "1G",
      node_args: "--max-old-space-size=1024",
      env_file: ".env"
    },
    {
      name: "cron-worker-upgrade",
      script: "./cron/upgradeWorker.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "512M",
      env_file: ".env"
    },
    {
      name: "warehouse-forwarder",
      script: "./workers/warehouseForwarder.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "512M",
      env_file: ".env"
    },
    {
      name: "diagnosis-worker",
      script: "./cron-runner.js",
      args: "Diagnosis",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "1G",
      node_args: "--max-old-space-size=1024",
      env_file: ".env"
    },
    {
      name: "cron-worker-sms-dlr",
      script: "./cron-runner.js",
      args: "SmsDlr",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "512M",
      env_file: ".env"
    },
    {
      name: "cron-worker-sms-send",
      script: "./cron-runner.js",
      args: "SmsSend",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "512M",
      env_file: ".env"
    },
  ]
};
