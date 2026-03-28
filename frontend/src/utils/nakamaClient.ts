import { Client } from "@heroiclabs/nakama-js";

const SERVER_HOST = process.env.REACT_APP_NAKAMA_HOST || "136.111.140.22";
const SERVER_PORT = process.env.REACT_APP_NAKAMA_PORT || "7350";
const USE_SSL = process.env.REACT_APP_NAKAMA_SSL === "true";

const client = new Client("defaultkey", SERVER_HOST, SERVER_PORT, USE_SSL);

export default client;