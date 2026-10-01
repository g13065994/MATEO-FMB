'use strict';
const fs=require('fs');const path=require('path');const {spawn}=require('child_process');
function arg(name){const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:null}
const pid=Number(arg('--pid'));const root=path.resolve(arg('--root')||process.cwd());const stage=path.resolve(arg('--stage')||'');const version=String(arg('--version')||'');if(!pid||!stage||!version)process.exit(2);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const alive=p=>{try{process.kill(p,0);return true}catch{return false}};
(async()=>{for(let i=0;i<120&&alive(pid);i++)await sleep(500);if(alive(pid))process.exit(3);
const state=path.join(root,'data','.mateo-update');const backup=path.join(state,'backup-'+Date.now());fs.mkdirSync(backup,{recursive:true});
const excludes=new Set(['data','node_modules','.git']);for(const name of fs.readdirSync(root)){if(excludes.has(name)||name.startsWith('.env'))continue;fs.cpSync(path.join(root,name),path.join(backup,name),{recursive:true,force:true});}
try{
 for(const name of fs.readdirSync(stage)){fs.cpSync(path.join(stage,name),path.join(root,name),{recursive:true,force:true});}
 fs.writeFileSync(path.join(state,'active.json'),JSON.stringify({version,activatedAt:new Date().toISOString()})+'\n');
 const child=spawn(process.execPath,[path.join(root,'index.js')],{cwd:root,env:{...process.env,MATEO_UPDATE_ACTIVATED_VERSION:version},detached:true,stdio:'ignore',windowsHide:true});child.unref();
 await sleep(10000);
 if(!alive(child.pid))throw new Error('post_update_process_failed');
 fs.writeFileSync(path.join(state,'success.json'),JSON.stringify({version,verifiedAt:new Date().toISOString()})+'\n');
}catch(error){
 for(const name of fs.readdirSync(backup)){fs.cpSync(path.join(backup,name),path.join(root,name),{recursive:true,force:true});}
 fs.writeFileSync(path.join(state,'rollback.json'),JSON.stringify({version,error:error.message,rolledBackAt:new Date().toISOString()})+'\n');process.exit(4)
}
})();