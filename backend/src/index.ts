import open, { apps } from "open";
import { initServer } from "./game_server";
import { initInternalServer } from "./internal_server";

export const FRONTEND_ADRESS = process.env.FRONTEND_ADRESS || "http://192.168.178.53:8080";


initServer();
initInternalServer();

//await open('https://sindresorhus.com', {app: {name: apps.chrome, arguments: [`--app=http://localhost:4000/localfrontend`, "--start-fullscreen"]}});


console.log("Hello via Bun!");
