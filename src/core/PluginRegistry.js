'use strict';
const path=require('path');const fs=require('fs');
class PluginRegistry{
 constructor({commandsDir,logger}={}){this.commandsDir=commandsDir;this.logger=logger;this.plugins=new Map();this.aliases=new Map()}
 load(){if(!fs.existsSync(this.commandsDir))return this;for(const file of fs.readdirSync(this.commandsDir).filter(f=>f.endsWith('.js')).sort()){try{const full=path.join(this.commandsDir,file);delete require.cache[require.resolve(full)];const plugin=require(full);if(!plugin?.name||typeof plugin.execute!=='function')continue;const name=String(plugin.name).toLowerCase();if(this.plugins.has(name))continue;this.plugins.set(name,plugin);for(const alias of plugin.aliases||[])this.aliases.set(String(alias).toLowerCase(),name)}catch(e){this.logger?.warn?.(`Plugin lifecycle skipped ${file}: ${e.message}`)}}return this}
 get(name){const key=String(name||'').toLowerCase();return this.plugins.get(this.aliases.get(key)||key)||null}
 list(){return [...this.plugins.values()].map(p=>({name:p.name,aliases:p.aliases||[],category:p.category||'general'}))}
 clear(){this.plugins.clear();this.aliases.clear()}
}
module.exports=PluginRegistry;