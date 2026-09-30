'use strict';
class DatabaseHealthMonitor{
 constructor({db,logger,intervalMs=60000}={}){this.db=db;this.logger=logger;this.intervalMs=Math.max(5000,Number(intervalMs)||60000);this.timer=null;this.last={ok:false,latencyMs:null,error:null,checkedAt:null}}
 async check(){const started=Date.now();try{if(typeof this.db?.health==='function')await this.db.health();else if(typeof this.db?.read==='function')await this.db.read();else if(!this.db?.data)throw new Error('Database is not initialized');this.last={ok:true,latencyMs:Date.now()-started,error:null,checkedAt:new Date().toISOString()};return this.last}catch(error){this.last={ok:false,latencyMs:Date.now()-started,error:error?.message||String(error),checkedAt:new Date().toISOString()};this.logger?.warn('Database health check failed: '+this.last.error);return this.last}}
 start(){if(this.timer)return this;this.check();this.timer=setInterval(()=>this.check(),this.intervalMs);this.timer.unref?.();return this}
 stop(){if(this.timer)clearInterval(this.timer);this.timer=null}
 status(){return {...this.last,running:Boolean(this.timer),intervalMs:this.intervalMs}}
}
module.exports=DatabaseHealthMonitor;