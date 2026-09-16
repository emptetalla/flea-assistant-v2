const fs=require('node:fs');const path=require('node:path');const {execFileSync}=require('node:child_process');const ejs=require('ejs');
for(const dir of ['src','public','scripts','test'])for(const file of fs.readdirSync(dir))if(file.endsWith('.js'))execFileSync(process.execPath,['--check',path.join(dir,file)],{stdio:'inherit'});
for(const file of fs.readdirSync('views'))if(file.endsWith('.ejs'))ejs.compile(fs.readFileSync(path.join('views',file),'utf8'),{filename:path.join('views',file)});
console.log('JavaScript構文・EJSコンパイル検査 OK（ビルド生成物なし）');
