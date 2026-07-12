const fs=require('node:fs'); const path=require('node:path');
function safeId(id){if(typeof id!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(id)) throw new Error('Invalid run id'); return id;}
function createStore(root){fs.mkdirSync(root,{recursive:true}); const index=path.join(root,'index.json');
  function atomic(file,data){const tmp=`${file}.tmp`;fs.writeFileSync(tmp,JSON.stringify(data,null,2));fs.renameSync(tmp,file);}
  return {create(id,config){safeId(id);const dir=path.join(root,id);fs.mkdirSync(dir,{recursive:false});atomic(path.join(dir,'config.json'),config);return dir;},save(id,name,data){safeId(id);const dir=path.join(root,id);atomic(path.join(dir,name),data);},list(){if(!fs.existsSync(index))return [];return JSON.parse(fs.readFileSync(index,'utf8'));},setIndex(rows){atomic(index,rows);},read(id,name){safeId(id);return JSON.parse(fs.readFileSync(path.join(root,id,name),'utf8'));},root};
}
module.exports={createStore,safeId};
