import assert from "node:assert/strict";

import { buildConfiguredWebexMessageArgs, getConfiguredWebexRoomId } from "./webex-routing";

assert.equal(
  getConfiguredWebexRoomId({
    WEBEX_SPACE_ID: " configured-manager-room ",
  } as NodeJS.ProcessEnv),
  "configured-manager-room"
);

assert.deepEqual(
  buildConfiguredWebexMessageArgs("store manager summary", {
    WEBEX_SPACE_ID: "configured-manager-room",
  } as NodeJS.ProcessEnv),
  { message: "store manager summary", roomId: "configured-manager-room" }
);

assert.deepEqual(
  buildConfiguredWebexMessageArgs("manager summary", {} as NodeJS.ProcessEnv),
  { message: "manager summary" }
);

console.log("Demo Webex routing regression passed");
