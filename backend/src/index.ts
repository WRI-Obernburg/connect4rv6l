import {initServer} from "./game_server";
import {initInternalServer} from "./internal_server";
import {initRV6LClient} from "./rv6l_client.ts";
import {ErrorType, initErrorHandler, logEvent} from "./errorHandler/error_handler.ts";

export const FRONTEND_ADDRESS = process.env.FRONTEND_ADDRESS || "http://localhost:8080";

await initErrorHandler();
logEvent({
    errorType: ErrorType.INFO,
    description: "RV6L Connect4 started at " + new Date().toLocaleString(),
    date: new Date().toString()
})
initRV6LClient();
initServer();
initInternalServer();

