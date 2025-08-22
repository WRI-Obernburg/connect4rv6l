FROM oven/bun:latest AS base
LABEL authors="timarnold"
COPY . /build
RUN mkdir /app /app/controlpanel /app/localfrontend
WORKDIR /build
RUN cd controlpanel && bun install && bun run build
RUN cd localfrontend && bun install && bun run build


FROM oven/bun:alpine
COPY --from=0 /build/controlpanel/dist /app/controlpanel
COPY --from=0 /build/localfrontend/dist /app/localfrontend
COPY --from=0 /build/backend /app/backend
WORKDIR /app/backend
RUN bun install
WORKDIR /app/backend
EXPOSE 3000
EXPOSE 4000
CMD ["bun", "run", "dev"]
