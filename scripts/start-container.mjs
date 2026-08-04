import { assertProductionEnvironment } from "./preflight-env.mjs";

assertProductionEnvironment();
await import("../server.js");
