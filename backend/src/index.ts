import {initServer} from "./game_server";
import {initInternalServer} from "./internal_server";
import {initRV6LClient} from "./rv6l_client.ts";
import {ErrorType, initErrorHandler, throwError} from "./errorHandler/error_handler.ts";

export const FRONTEND_ADRESS = process.env.FRONTEND_ADRESS || "http://192.168.1.57:8080";

await initErrorHandler();
throwError({
    errorType: ErrorType.INFO,
    description: "RV6L Connect4 started at " + new Date().toLocaleString(),
    date: new Date().toString()
})
initRV6LClient();
initServer();
initInternalServer();

//await open('https://sindresorhus.com', {app: {name: apps.chrome, arguments: [`--app=http://localhost:4000/localfrontend`, "--start-fullscreen"]}});


console.log("Hello via Bun!");
