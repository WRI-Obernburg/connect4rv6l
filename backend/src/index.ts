import open, { apps } from "open";
import { initServer } from "./game_server";
import { initInternalServer } from "./internal_server";
import {initRV6LClient} from "./rv6l_client.ts";

export const FRONTEND_ADRESS = process.env.FRONTEND_ADRESS || "http://localhost:8080";

initRV6LClient();
initServer();
initInternalServer();

//await open('https://sindresorhus.com', {app: {name: apps.chrome, arguments: [`--app=http://localhost:4000/localfrontend`, "--start-fullscreen"]}});


console.log("Hello via Bun!");
