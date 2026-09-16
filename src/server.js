const fs=require('node:fs');const path=require('node:path');
const {openDb}=require('./db');const {createApp}=require('./app');
const root=path.join(__dirname,'..');
for(const folder of ['data','imports/mercari','imports/yahoo','imports/rakuma','backups'])fs.mkdirSync(path.join(root,folder),{recursive:true});
const db=openDb(path.join(root,'data/flea-v2.db'));const port=Number(process.env.PORT||3211);
const server=createApp(db).listen(port,'127.0.0.1',()=>console.log(`フリマ運営アプリ V2: http://127.0.0.1:${port}`));
server.on('error',error=>{console.error(error.message);db.close();process.exitCode=1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{db.close();process.exit(0);}));
