#!/bin/sh
set -e

# 容器以 root 启动，先修复挂载卷的属主为 node 用户（UID 1000）
# 这样无论宿主机 ./public ./data 是什么权限，容器内 node 用户都能读写
chown -R node:node /app/public /app/data 2>/dev/null || true

# 切换到 node 用户执行主命令
exec gosu node:node "$@"
