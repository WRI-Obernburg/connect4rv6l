FROM oven/bun:latest
LABEL authors="timarnold"
COPY . /build
RUN mkdir /app /app/controlpanel /app/localfrontend
WORKDIR /build
RUN cd controlpanel && bun install && bun run build
RUN cd localfrontend && bun install && bun run build
RUN cp -r /build/controlpanel/dist /app/controlpanel/dist
RUN cp -r /build/localfrontend/dist /app/localfrontend/dist
RUN cp -r /build/backend /app/backend
RUN rm -rf /build
WORKDIR /app
RUN cd backend && bun install
WORKDIR /app/backend
EXPOSE 3000
EXPOSE 4000
CMD ["bun", "run", "dev"]
