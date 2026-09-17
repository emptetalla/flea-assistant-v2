const fs=require('node:fs');const path=require('node:path');
const {createBackupManager}=require('./backups');const {createApp}=require('./app');
const root=path.join(__dirname,'..');
for(const folder of ['data','imports/mercari','imports/yahoo','imports/rakuma','backups'])fs.mkdirSync(path.join(root,folder),{recursive:true});
const backups=createBackupManager(path.join(root,'data/flea-v2.db'),path.join(root,'backups'));const db=backups.db;const port=Number(process.env.PORT||3211);
const server=createApp(db,backups).listen(port,'127.0.0.1',()=>console.log(`フリマ運営アプリ V2: http://127.0.0.1:${port}`));
server.on('error',error=>{console.error(error.message);db.close();process.exitCode=1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{db.close();process.exit(0);}));
