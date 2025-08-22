FROM oven/bun:latest
LABEL authors="timarnold"
COPY . /build
WORKDIR /build
RUN cd controlpanel && bun install && bun run build
RUN cd localfrontend && bun install && bun run build
COPY controlpanel/dist /app/controlpanel/dist
COPY localfrontend/dist /app/localfrontend/dist
COPY backend /app/backend
RUN rm -rf /build
WORKDIR /app
RUN cd backend && bun install
WORKDIR /app/backend
EXPOSE 3000
EXPOSE 4000
CMD ["bun", "run", "dev"]
