module.exports = {
  apps: [
    // 🌐 WEB APPLICATION LAYER (Multi-Core Cluster)
    {
      name: "automation-server",
      script: "/home/automation/backend/server.js",
      instances: "max",
      exec_mode: "cluster",
      max_memory_restart: "2G",
      env: {
        NODE_OPTIONS: "--max-old-space-size=2048"
      }
    },
    // ⚙️ ISOLATED BACKGROUND CRON PROCESSES (Single-Instance Fork Mode)
    {
      name: "cron-worker-dia",
      script: "./cron-runner.js",
      args: "DIA",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "2G"
    },
    {
      name: "cron-worker-ipt",
      script: "./cron-runner.js",
      args: "IPT",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "2G"
    },
    {
      name: "cron-worker-shared",
      script: "./cron-runner.js",
      args: "Shared",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "2G"
    },
    {
      name: "cron-worker-l3vpn",
      script: "./cron-runner.js",
      args: "L3VPN",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "2G"
    },
    {
      name: "cron-worker-ftth",
      script: "./cron-runner.js",
      args: "FTTH",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "3G", // BNG routing lists are large; give it extra room
      env: {
        NODE_OPTIONS: "--max-old-space-size=3072"
      }
    },
   {
      name: "cron-worker-isis",
      script: "./cron-runner.js",
      args: "ISIS",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "2G"
    }
  ]
};