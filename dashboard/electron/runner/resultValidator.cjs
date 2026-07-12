const fs=require('node:fs');

function validateResult(data,config){
  if(!data||typeof data!=='object')throw new Error('Backend returned invalid JSON');
  for(const key of ['runtimeMs','burnedCells','checksum'])if(!(key in data))throw new Error(`Backend result missing ${key}`);
  if(data.runtimeMs?.median==null)throw new Error('Backend result missing median runtime');
  if(data.burnedCells<0||typeof data.checksum!=='string')throw new Error('Backend result has invalid values');
  return data;
}

function decodedLength(value,label,expected){
  if(typeof value!=='string'||value.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw new Error(`Invalid ${label} Base64`);
  const length=Buffer.from(value,'base64').length;
  if(length!==expected)throw new Error(`Invalid ${label} byte length`);
}

function validateTrace(trace,expected){
  if(!trace||typeof trace!=='object'||trace.schemaVersion!==2)throw new Error('Invalid compressed trace schema');
  const required={sourceRows:expected.rows,sourceCols:expected.cols,previewRows:500,previewCols:500,aggregationRows:expected.rows/500,aggregationCols:expected.cols/500,steps:expected.steps,frameInterval:10,density:expected.density,seed:expected.seed};
  for(const [key,value] of Object.entries(required))if(trace[key]!==value)throw new Error(`Invalid trace ${key}`);
  if(!Array.isArray(trace.frames)||trace.frames.length<2)throw new Error('Invalid trace frames');
  const expectedFrameSteps=[0];
  for(let step=10;step<=expected.steps;step+=10)expectedFrameSteps.push(step);
  if(expectedFrameSteps.at(-1)!==expected.steps)expectedFrameSteps.push(expected.steps);
  if(trace.frames.length!==expectedFrameSteps.length||trace.frames.some((frame,index)=>frame?.step!==expectedFrameSteps[index]))throw new Error('Invalid trace frame interval schedule');
  let prior=-1;
  for(const frame of trace.frames){
    if(!frame||!Number.isInteger(frame.step)||frame.step<0||frame.step>expected.steps||frame.step<=prior)throw new Error('Invalid trace frame ordering');
    prior=frame.step;
    decodedLength(frame.cells2BitBase64,'majority cells',62500);
    decodedLength(frame.burningMaskBase64,'burning mask',31250);
  }
  if(trace.frames[0].step!==0)throw new Error('Invalid trace initial step');
  if(trace.frames.at(-1).step!==expected.steps)throw new Error('Invalid trace final step');
  return trace;
}

function readResult(file,config){return validateResult(JSON.parse(fs.readFileSync(file,'utf8')),config)}
module.exports={validateResult,validateTrace,readResult};
