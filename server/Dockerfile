FROM node:20-bookworm-slim

# 使用阿里云镜像加速（国内服务器构建更快；海外服务器可删除这三行）
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources \
    && sed -i 's|security.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources

# 安装 Chromium（来自 Debian 官方源，无需添加 Google 源）及中文字体
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        chromium \
        fonts-freefont-ttf \
        fonts-noto-color-emoji \
        fonts-noto-cjk \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Puppeteer 不再下载自带 Chromium，使用系统安装的 chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# 使用淘宝 npm 镜像加速（国内服务器；海外可改为 https://registry.npmjs.org）
RUN npm config set registry https://registry.npmmirror.com

COPY package.json package-lock.json* ./
RUN npm install --production

COPY . .

# 预创建输出目录，确保 appuser 有写权限
RUN mkdir -p /app/public

# 创建非特权用户运行 Chromium
# 固定 UID/GID=1000，与宿主机挂载目录 ./public 权限对齐
# 宿主机需执行：mkdir -p ./public && chown -R 1000:1000 ./public
RUN groupadd -r -g 1000 appuser \
    && useradd -r -u 1000 -g appuser -G audio,video appuser \
    && mkdir -p /home/appuser/Downloads \
    && chown -R appuser:appuser /home/appuser \
    && chown -R appuser:appuser /app

USER appuser

CMD ["node", "src/index.js"]
