'use strict';
// Evidence is provided only by the server's currently leased task, never tool arguments.
const context=new(require('node:async_hooks').AsyncLocalStorage)();
module.exports={context,run:(scope,work)=>context.run(scope,work)};
