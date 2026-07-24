#!/usr/bin/env sh
DEBUG=${DEBUG:-false}
[ "$DEBUG" = true ] && set -x

DIR="$(dirname "$0")"
DASH_PNG="$DIR/dash.png"
FETCH_DASHBOARD_CMD="$DIR/local/fetch-dashboard.sh"
LOW_BATTERY_CMD="$DIR/local/low-battery.sh"

REFRESH_SCHEDULE=${REFRESH_SCHEDULE:-"2,32 8-17 * * MON-FRI"}
FULL_DISPLAY_REFRESH_RATE=${FULL_DISPLAY_REFRESH_RATE:-0}
SLEEP_SCREEN_INTERVAL=${SLEEP_SCREEN_INTERVAL:-3600}

# 自动检测 RTC 唤醒路径（不同 Kindle 型号路径不同）
detect_rtc() {
  for path in \
    /sys/devices/platform/mxc_rtc.0/wakeup_enable \
    /sys/devices/platform/mxc_rtc.1/wakeup_enable \
    /sys/class/rtc/rtc0/wakealarm; do
    [ -f "$path" ] && echo "$path" && return
  done
  echo ""
}
RTC=$(detect_rtc)

LOW_BATTERY_REPORTING=${LOW_BATTERY_REPORTING:-false}
LOW_BATTERY_THRESHOLD_PERCENT=${LOW_BATTERY_THRESHOLD_PERCENT:-10}

num_refresh=0

init() {
  if [ -z "$TIMEZONE" ] || [ -z "$REFRESH_SCHEDULE" ]; then
    echo "Missing required configuration."
    echo "Timezone: ${TIMEZONE:-(not set)}."
    echo "Schedule: ${REFRESH_SCHEDULE:-(not set)}."
    exit 1
  fi

  echo "Starting dashboard with $REFRESH_SCHEDULE refresh..."
  echo "Detected RTC: ${RTC:-none (will use sleep fallback)}"

  # 停止 Kindle 原生框架（KPW7 上 /etc/init.d/framework 不存在，
  # 报错可忽略——eips 仍可正常工作，不要用 initctl 强行停止，否则会破坏显示）
  /etc/init.d/framework stop 2>/dev/null
  initctl stop webreader >/dev/null 2>&1
  echo powersave >/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null
  lipc-set-prop com.lab126.powerd preventScreenSaver 1
}

prepare_sleep() {
  echo "Preparing sleep"

  /usr/sbin/eips -f -g "$DIR/sleeping.png"

  # Give screen time to refresh
  sleep 2

  # Ensure a full screen refresh is triggered after wake from sleep
  num_refresh=$FULL_DISPLAY_REFRESH_RATE
}

refresh_dashboard() {
  echo "Refreshing dashboard"
  "$DIR/wait-for-wifi.sh" "$WIFI_TEST_IP"

  "$FETCH_DASHBOARD_CMD" "$DASH_PNG"
  fetch_status=$?

  if [ "$fetch_status" -ne 0 ]; then
    echo "Not updating screen, fetch-dashboard returned $fetch_status"
    return 1
  fi

  if [ "$num_refresh" -eq "$FULL_DISPLAY_REFRESH_RATE" ]; then
    num_refresh=0

    # trigger a full refresh once in every 4 refreshes, to keep the screen clean
    echo "Full screen refresh"
    /usr/sbin/eips -f -g "$DASH_PNG"
  else
    echo "Partial screen refresh"
    /usr/sbin/eips -g "$DASH_PNG"
  fi

  num_refresh=$((num_refresh + 1))
}

log_battery_stats() {
  battery_level=$(gasgauge-info -c)
  echo "$(date) Battery level: $battery_level."

  if [ "$LOW_BATTERY_REPORTING" = true ]; then
    battery_level_numeric=${battery_level%?}
    if [ "$battery_level_numeric" -le "$LOW_BATTERY_THRESHOLD_PERCENT" ]; then
      "$LOW_BATTERY_CMD" "$battery_level_numeric"
    fi
  fi
}

rtc_sleep() {
  duration=$1

  if [ "$DEBUG" = true ]; then
    sleep "$duration"
  elif [ -z "$RTC" ]; then
    # 无 RTC 唤醒支持，用 sleep 兜底（不真正休眠，耗电但能工作）
    echo "No RTC available, using sleep fallback for ${duration}s"
    sleep "$duration"
  else
    case "$RTC" in
      */wakealarm)
        # /sys/class/rtc/rtc0/wakealarm 接受相对时间（+秒数）
        echo 0 > "$RTC" 2>/dev/null
        echo "+$duration" > "$RTC" 2>/dev/null
        echo "mem" >/sys/power/state
        ;;
      *)
        # mxc_rtc.N/wakeup_enable 接受相对秒数
        rtc_val=$(cat "$RTC" 2>/dev/null)
        [ "$rtc_val" = "0" ] 2>/dev/null && echo -n "$duration" >"$RTC" 2>/dev/null
        echo "mem" >/sys/power/state
        ;;
    esac
  fi
}

main_loop() {
  while true; do
    log_battery_stats

    next_wakeup_secs=$("$DIR/next-wakeup" --schedule="$REFRESH_SCHEDULE" --timezone="$TIMEZONE")

    if [ "$next_wakeup_secs" -gt "$SLEEP_SCREEN_INTERVAL" ]; then
      action="sleep"
      prepare_sleep
    else
      action="suspend"
      refresh_dashboard
    fi

    # take a bit of time before going to sleep, so this process can be aborted
    sleep 10

    echo "Going to $action, next wakeup in ${next_wakeup_secs}s"

    rtc_sleep "$next_wakeup_secs"
  done
}

init
main_loop
