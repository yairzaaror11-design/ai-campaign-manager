"use strict";
require("dotenv").config();
const app = require("../index");
app.use("/app/modules", require("./router").router);
async function start() {
  await require("../db").initializeDatabase();
  await require("./common").initialize();
  return app.start();
}
if (require.main === module)
  start().catch(() => {
    console.error("SCORPIO_STARTUP_FAILED");
    process.exitCode = 1;
  });
module.exports = { app, start };
