FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY public ./public
# Dữ liệu (wheel.json + ảnh) nằm ở volume /data, không mất khi build lại
ENV DATA_DIR=/data PORT=3000
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "server/index.js"]
