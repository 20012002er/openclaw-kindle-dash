#!/usr/bin/env sh
# Fetch a new dashboard image, make sure to output it to "$1".
#
# DASHBOARD_URL should point to your kindle-dash-server instance.
# Set it in env.sh, for example:
#   DASHBOARD_URL="http://your-aliyun-server:3000/dash.png"
"$(dirname "$0")/../xh" -d -q -o "$1" get "$DASHBOARD_URL"
