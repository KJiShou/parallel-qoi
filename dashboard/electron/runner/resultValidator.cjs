const fs=require('node:fs');
function validateResult(data,config){if(!data||typeof data!=='object')throw new Error('Backend returned invalid JSON'); for(const key of ['runtimeMs','burnedCells','checksum'])if(!(key in data))throw new Error(`Backend result missing ${key}`); if(data.runtimeMs?.median==null)throw new Error('Backend result missing median runtime'); if(data.burnedCells<0||typeof data.checksum!=='string')throw new Error('Backend result has invalid values'); return data;}
function readResult(file,config){return validateResult(JSON.parse(fs.readFileSync(file,'utf8')),config)}
module.exports={validateResult,readResult};
