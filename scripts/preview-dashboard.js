'use strict';
// Local UI preview only: no database initialization, workers, providers or messages.
const express=require('express');
const app=express();
app.use(express.json({limit:'16kb'}));
app.use('/app',require('../dashboard').router);
app.get('/',(req,res)=>res.redirect('/app/demo'));
app.listen(Number(process.env.DASHBOARD_PREVIEW_PORT||4173),'127.0.0.1',()=>console.log('Dashboard preview: http://127.0.0.1:4173/app/demo'));
