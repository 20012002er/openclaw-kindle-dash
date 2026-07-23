#!/usr/bin/env sh

# ===== 仪表盘图片地址 =====
# 指向你部署在阿里云上的 kindle-dash-server
export DASHBOARD_URL=${DASHBOARD_URL:-"http://your-aliyun-server:3000/dash.png"}

# Export environment variables here
export WIFI_TEST_IP=${WIFI_TEST_IP:-1.1.1.1}

# 刷新频率：默认每 10 分钟刷新一次（后端每 5 分钟生成新图片）
# 可按需调整，如每 5 分钟: "*/5 * * * *"，每小时: "0 * * * *"
export REFRESH_SCHEDULE=${REFRESH_SCHEDULE:-"*/10 * * * *"}
export TIMEZONE=${TIMEZONE:-"Asia/Shanghai"}

# By default, partial screen updates are used to update the screen,
# to prevent the screen from flashing. After a few partial updates,
# the screen will start to look a bit distorted (due to e-ink ghosting).
# This number determines when a full refresh is triggered. By default it's
# triggered after 4 partial updates.
export FULL_DISPLAY_REFRESH_RATE=${FULL_DISPLAY_REFRESH_RATE:-4}

# When the time until the next wakeup is greater or equal to this number,
# the dashboard will not be refreshed anymore, but instead show a
# 'kindle is sleeping' screen. This can be useful if your schedule only runs
# during the day, for example.
export SLEEP_SCREEN_INTERVAL=3600

export LOW_BATTERY_REPORTING=${LOW_BATTERY_REPORTING:-false}
export LOW_BATTERY_THRESHOLD_PERCENT=10
