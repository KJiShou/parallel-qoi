const path=require('node:path');
function baseArgs(config){return ['--rows',String(config.rows),'--cols',String(config.cols),'--steps',String(config.steps),'--density',String(config.density),'--seed',String(config.seed)];}
function buildCommand(config,{rootDir,buildDir=path.join(rootDir,'build_verified','Release'),mpiexec='mpiexec'}={}){
  const base=baseArgs(config); const outputName=`${config.backend}-${config.rows}x${config.cols}-${Date.now()}.json`; const outputPath=path.join(rootDir,'results','live',outputName);
  if(config.backend==='serial') return {file:path.join(buildDir,'wildfire_serial.exe'),args:[...base,'--output',outputPath],outputPath};
  if(config.backend==='openmp') return {file:path.join(buildDir,'wildfire_openmp.exe'),args:[...base,'--threads',String(config.threads),'--output',outputPath],outputPath};
  if(config.backend==='cuda') return {file:path.join(buildDir,'wildfire_cuda.exe'),args:[...base,'--block-size',String(config.blockSize),'--output',outputPath],outputPath};
  return {file:mpiexec,args:['-n',String(config.processes),path.join(buildDir,'wildfire_mpi.exe'),...base,'--output',outputPath],outputPath};
}
function buildTraceCommand(config,{rootDir,buildDir=path.join(rootDir,'build_verified','Release'),traceSteps}={}){
  if(!Number.isInteger(traceSteps)||traceSteps<1||traceSteps>1000) throw new Error('traceSteps must be an integer from 1 to 1000');
  const tracePath=path.join(rootDir,'results','live',`trace-${config.rows}x${config.cols}-${Date.now()}.json`);
  const traceConfig={...config,steps:traceSteps};
  return {file:path.join(buildDir,'wildfire_serial.exe'),args:[...baseArgs(traceConfig),'--repetitions','1','--warmup','0','--frames',tracePath,'--frame-interval','10','--trace-only'],tracePath};
}
module.exports={buildCommand,buildTraceCommand};
