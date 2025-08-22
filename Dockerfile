FROM oven/bun:latest
LABEL authors="timarnold"
COPY . /app
WORKDIR /app
RUN cd controlpanel && bun install && bun run build
RUN cd localfrontend && bun install && bun run build
RUN cd backend && bun install
WORKDIR /app/backend
EXPOSE 3000
EXPOSE 4000
CMD ["bun", "run", "dev"]
